"""
Celery tasks for scraping and scheduled job dispatch.
"""
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models.scrape_task import ScrapeTask

from datetime import date


@celery_app.task(bind=True, name="app.tasks.scrape.process_scrape")
def process_scrape(self, task_id: str):
    """
    Phase 1: Scrape the URL, compress HTML, run AI extraction.
    Writes results to extracted_products and updates scrape_task status.
    """
    db = SessionLocal()
    try:
        task = db.query(ScrapeTask).filter(ScrapeTask.id == task_id).first()
        if not task:
            return f"Task {task_id} not found"

        # Phase 3: Web Scraping
        task.status = "scraping"
        task.progress = 30
        task.append_activity("scraping", f"Fetching HTML from {task.url}")
        db.commit()

        import time
        from curl_cffi import requests as cffi_requests
        from bs4 import BeautifulSoup
        import json
        import os

        # Fetch URL with retry logic for rate limits (429)
        max_retries = 3
        html_content = ""
        
        for attempt in range(max_retries):
            try:
                # Use curl_cffi to impersonate Chrome and bypass Cloudflare/Shopify bot detection
                response = cffi_requests.get(
                    task.url, 
                    impersonate="chrome110",
                    timeout=30.0,
                    allow_redirects=True
                )
                
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        sleep_time = 10 * (attempt + 1)
                        task.append_activity("scraping", f"Rate limited (429). Retrying in {sleep_time}s...")
                        db.commit()
                        time.sleep(sleep_time)
                        continue
                    else:
                        response.raise_for_status()
                
                response.raise_for_status()
                html_content = response.text
                break # Success!
            except Exception as e:
                # If it's a 429 and we still have retries (handled above), otherwise raise
                if attempt == max_retries - 1 or "429" not in str(e):
                    raise e

        # Compress HTML using BeautifulSoup
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Remove script, style, and SVG tags
        for el in soup(["script", "style", "svg", "noscript", "header", "footer", "nav"]):
            el.extract()
            
        clean_text = soup.get_text(separator=" ", strip=True)
        
        # Manually extract images so LLM can see them
        extracted_images = []
        for img in soup.find_all('img'):
            src = img.get('src') or img.get('data-src') or img.get('srcset')
            if src and not src.startswith('data:'):
                if src.startswith('//'):
                    src = 'https:' + src
                elif src.startswith('/'):
                    src = task.url.rstrip('/') + src
                # Ignore very small or irrelevant images
                alt = img.get('alt', '')
                extracted_images.append(f"Image: {src} | Alt: {alt}")
                
        # Get unique images keeping order
        seen = set()
        unique_images = []
        for img_str in extracted_images:
            if img_str not in seen:
                seen.add(img_str)
                unique_images.append(img_str)
                
        images_context = "\n".join(unique_images) # NO TRUNCATION

        task.status = "ai_processing"
        task.progress = 60
        task.raw_html = soup.prettify() # Save the actual prettified HTML for Content Preview
        task.append_activity("ai_processing", "HTML compressed, running extraction")
        db.commit()

        # Try to extract via meta tags for fallback/mock
        title = soup.find("meta", property="og:title")
        description = soup.find("meta", property="og:description")
        image = soup.find("meta", property="og:image")
        
        title_val = title["content"] if title else soup.title.string if soup.title else "Unknown Product"
        desc_val = description["content"] if description else clean_text[:200] + "..."
        img_val = image["content"] if image else ""

        # Here we call Litellm + DeepSeek + Serper
        from app.config_loader import get_dynamic_env
        deepseek_key = get_dynamic_env("DEEPSEEK_API_KEY")
        serper_key = get_dynamic_env("SERPER_API_KEY")
        
        product_data = {}
        if deepseek_key and deepseek_key.strip():
            # ── Deepseek Worker Credit Check ─────────────────────────
            from app.services.credit_service import deepseek_worker_check
            ds_check = deepseek_worker_check()
            if ds_check["status"] == "block":
                raise Exception(f"Deepseek credits exhausted: {ds_check.get('reason')}")
            # ─────────────────────────────────────────────────────────

            from litellm import completion
            import httpx
            
            # --- PHASE A: SOURCE EXTRACTION ---
            task.append_activity("ai_processing", "Extracting strict source_data from HTML")
            db.commit()
            
            from app.tasks.source_extraction import extract_source_data
            source_data = extract_source_data(clean_text, unique_images, deepseek_key)
            task.source_data = source_data
            db.commit()
            
            product_name = source_data.get("product_identity", {}).get("product_name") or title_val
            
            serper_data = ""
            if serper_key and serper_key.strip() and product_name:
                task.append_activity("ai_processing", f"Querying Serper for '{product_name}'")
                db.commit()
                try:
                    serper_resp = httpx.post(
                        "https://google.serper.dev/search",
                        headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                        json={"q": f"{product_name} specifications details"}
                    )
                    serper_resp.raise_for_status()
                    serper_data = json.dumps(serper_resp.json().get("organic", [])[:3])
                except Exception as se:
                    print(f"Serper error: {se}")

            # Read the user's detailed system prompt
            system_prompt_path = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
            try:
                with open(system_prompt_path, "r", encoding="utf-8") as f:
                    system_prompt_text = f.read()
            except Exception as e:
                print(f"Could not load system_prompt.txt: {e}")
                system_prompt_text = "You are a product enrichment agent."

            # --- PHASE B: AI ENRICHMENT ---
            task.append_activity("ai_processing", "Finalizing JSON with DeepSeek agent using detailed schema")
            db.commit()
            
            # We provide the structured source_data and the Serper context.
            prompt2 = f"Source Data (Structured JSON):\n{json.dumps(source_data, indent=2)}\n\nFound Images:\n{images_context}\n\nExtra Search Context (Serper): {serper_data}\n\nPerform Phase 1, Phase 5, Phase 6, and output the final JSON exactly as specified in the OUTPUT FORMAT."
            
            try:
                ai_resp2 = completion(
                    model="deepseek/deepseek-chat",
                    messages=[
                        {"role": "system", "content": system_prompt_text},
                        {"role": "user", "content": prompt2}
                    ],
                    api_key=deepseek_key,
                    response_format={"type": "json_object"}
                )
                product_data = json.loads(ai_resp2.choices[0].message.content)
                # Ensure images list is populated correctly
                if not product_data.get("images") and img_val:
                    product_data["images"] = [img_val]
            except Exception as e:
                task.append_activity("DeepSeek_enrichment_failed", str(e))
                raise Exception(f"DeepSeek JSON enrichment failed: {str(e)}")
        else:
            # Fallback JSON
            product_data = {
                "title": title_val,
                "description": desc_val,
                "price": "$0.00",
                "features": ["Durable", "High quality"],
                "images": [img_val] if img_val else [],
                "source_url": task.url
            }

        # Save to database
        task.product_data = product_data
        
        if task.generate_ai_images:
            images_val = product_data.get("images")
            if isinstance(images_val, dict):
                scraped = images_val.get("scraped_images", [])
            elif isinstance(images_val, list):
                scraped = images_val
            else:
                scraped = []
                
            unique_urls = set()
            for item in scraped:
                url = item.get("url") if isinstance(item, dict) else item
                if isinstance(url, str) and url.strip() and not url.startswith("data:"):
                    unique_urls.add(url.strip())
                    
            if len(unique_urls) < 2:
                task.status = "error"
                task.error_message = f"No reference image found. At least 2 valid scraped reference images are required for image generation. Found: {len(unique_urls)}."
                task.progress = 90
                task.append_activity("Image_generation_blocked_no_reference_images", f"Image generation blocked: required = 2, found = {len(unique_urls)}")
                db.commit()
                return f"Task {task_id} image generation blocked due to insufficient reference images"
            
            task.status = "image_generation"
            task.progress = 90
            task.append_activity("image_generation", "Extraction complete, starting image generation")
            db.commit()
            
            # Dispatch image generation background task
            from app.celery_app import celery_app
            celery_app.send_task("app.tasks.gen_images.generate_images_task", args=[task_id])
            
            return f"Task {task_id} scrape complete → image_generation"
        else:
            task.status = "waiting_for_approval"
            task.progress = 90
            task.append_activity("waiting_for_approval", "Extraction complete, awaiting admin review")
            db.commit()

            return f"Task {task_id} scrape complete → waiting_for_approval"

    except Exception as e:
        error_str = str(e).lower()
        is_recoverable = any(term in error_str for term in [
            "429", "500", "502", "503", "504", "timeout", "rate limit", 
            "insufficient", "credit", "quota", "connection"
        ])
        
        task.status = "rescheduled" if is_recoverable else "error"
        task.error_message = str(e)
        task.append_activity("Task_processing_failed", str(e))
        db.commit()
        return f"Task {task_id} failed: {e}"
    finally:
        db.close()


@celery_app.task(name="app.tasks.scrape.dispatch_scheduled_jobs")
def dispatch_scheduled_jobs():
    """
    Celery Beat periodic task: find scrape_tasks with
    scheduled_date <= today and status='pending', dispatch them.
    """
    db = SessionLocal()
    try:
        today = date.today()
        due_tasks = (
            db.query(ScrapeTask)
            .filter(
                ScrapeTask.status == "pending",
                ScrapeTask.scheduled_date <= today,
            )
            .all()
        )

        dispatched = 0
        for task in due_tasks:
            try:
                task.status = "queued"
                task.append_activity("queued", "Dispatched by Celery Beat scheduler")
                db.commit()
                # Dispatch the actual scrape task
                process_scrape.delay(task.id)
                dispatched += 1
            except Exception as e:
                task.status = "failed"
                task.error_message = f"Failed to dispatch to Celery: {e}"
                task.append_activity("failed", f"Beat dispatch error: {e}")
                db.commit()

        return f"Dispatched {dispatched} scheduled job(s)"
    finally:
        db.close()
