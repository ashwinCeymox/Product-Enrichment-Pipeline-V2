"""
Celery tasks for scraping and scheduled job dispatch.
"""
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models.scrape_task import ScrapeTask

from datetime import date
import re
from urllib.parse import urljoin
from bs4 import BeautifulSoup

def extract_all_images(html_content, base_url, soup=None):
    if not soup:
        soup = BeautifulSoup(html_content, "html.parser")
        
    site_images = []
    seen_images = set()

    def add_image(src, alt=""):
        if not src:
            return
        if ',' in src and ' ' in src:
            src = src.split(',')[0].strip().split(' ')[0]
        if src.startswith('data:'):
            return
        abs_src = urljoin(base_url, src)
        
        lower_src = abs_src.lower()
        if any(j in lower_src for j in ['1x1', 'base64', 'sprite', 'icon', 'nav-', '.gif']):
            return
            
        img_str = f"Image: {abs_src} | Alt: {alt}"
        if img_str not in seen_images:
            seen_images.add(img_str)
            site_images.append(img_str)

    for element in soup.find_all(['img', 'source']):
        src = element.get('data-src') or element.get('data-original') or element.get('data-lazy-src') or element.get('srcset') or element.get('data-srcset') or element.get('src')
        alt = element.get('alt', '')
        add_image(src, alt)
        
    regex_urls = re.findall(r'https?(?::|\\\\u003a)?(?:/|\\\\/){2}[^\s\"\'<>;&\[\]\{\}]+\.(?:jpg|jpeg|png|webp)', html_content, re.IGNORECASE)
    for raw_url in regex_urls:
        raw_url = raw_url.replace("\\/", "/").replace("\\u003a", ":").replace("\\U003A", ":")
        add_image(raw_url, "Extracted via regex")
        
    return site_images


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


        # --- BrowserBase Pipeline Initialization ---
        import time
        from bs4 import BeautifulSoup
        import json
        import os
        import httpx
        from litellm import completion
        
        from app.config_loader import get_dynamic_env
        deepseek_key = get_dynamic_env("DEEPSEEK_API_KEY")
        serper_key = get_dynamic_env("SERPER_API_KEY")
        
        import logging
        logger = logging.getLogger(__name__)

        def fetch_via_steel_mcp(target_url):
            import asyncio
            import json
            from mcp import ClientSession
            from mcp.client.stdio import stdio_client, StdioServerParameters
            import sys
            
            async def _run():
                try:
                    params = StdioServerParameters(
                        command="node",
                        args=["/opt/steel-mcp-server/dist/stdio.js"],
                        env={
                            "STEEL_LOCAL": "true",
                            "STEEL_BASE_URL": "http://steel-api:3000",
                            "GLOBAL_WAIT_SECONDS": "1",
                            "PATH": "/usr/local/bin:/usr/bin:/bin"
                        }
                    )
                    
                    async with stdio_client(params, errlog=sys.__stderr__) as (read, write):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            
                            import asyncio

                            # Use delay_ms to give JS-heavy sites (Next.js, React) time to render
                            # after initial page load before Steel snapshots the DOM
                            result = await asyncio.wait_for(
                                session.call_tool(
                                    "steel_scrape",
                                    arguments={
                                        "url": target_url,
                                        "format": ["html"],
                                        "max_tokens": 100000,
                                        "delay_ms": 5000,
                                    }
                                ),
                                timeout=60
                            )
                            
                            if getattr(result, "isError", False):
                                logger.error(f"steel_scrape failed for {target_url}: {result.content}")
                                return None
                            
                            content_pieces = result.content if hasattr(result, "content") else []
                            text = ""
                            for piece in content_pieces:
                                if hasattr(piece, "text"):
                                    text += piece.text
                                elif isinstance(piece, str):
                                    text += piece
                            
                            return text
                except asyncio.TimeoutError:
                    logger.error(f"MCP Fetch Timeout for {target_url}")
                    return None
                except Exception as e:
                    logger.error(f"MCP Fetch Failed for {target_url}: {e}")
                    return None
            
            try:
                # Wrap the entire spawn + init + execute lifecycle to prevent frozen workers
                return asyncio.run(asyncio.wait_for(_run(), timeout=45.0))
            except asyncio.TimeoutError:
                logger.error(f"MCP Subprocess Spawn/Init Timeout for {target_url}")
                return None
            except Exception as e:
                logger.error(f"MCP Subprocess Error for {target_url}: {e}")
                return None

        def bulk_image_extraction(query: str):
            """
            Separate, simpler pipeline for bulk image collection.
            STEP 1: Serper integration
            STEP 2: Image URL extraction per site
            STEP 3: Output format
            STEP 4: Error handling
            """
            import os
            import httpx
            from urllib.parse import urljoin
            from bs4 import BeautifulSoup
            
            serper_api_key = get_dynamic_env("SERPER_API_KEY")
            if not serper_api_key or not serper_api_key.strip():
                raise ValueError("SERPER_API_KEY is missing from environment")

            # Step 1: Serper Search
            try:
                serper_resp = httpx.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": serper_api_key, "Content-Type": "application/json"},
                    json={"q": query},
                    timeout=15.0
                )
                serper_resp.raise_for_status()
            except Exception as e:
                raise RuntimeError(f"Serper API request failed: {e}")
            
            organic_results = serper_resp.json().get("organic", [])
            top_urls = [item["link"] for item in organic_results if "link" in item][:3]

            results = []

            # Step 2 & 4: Scrape each URL, handling errors gracefully
            for url in top_urls:
                html_content = fetch_via_steel_mcp(url)
                if not html_content:
                    logger.warning(f"Skipping {url} due to MCP scrape failure.")
                    continue
                
                import re
                
                # Parse HTML for images via standard tags
                soup = BeautifulSoup(html_content, "html.parser")
                site_images = []
                seen_images = set()

                def add_image(src):
                    if not src:
                        return
                    if ',' in src and ' ' in src:
                        src = src.split(',')[0].strip().split(' ')[0]
                    if src.startswith('data:'):
                        return
                    abs_src = urljoin(url, src)
                    
                    # Filter junk
                    lower_src = abs_src.lower()
                    if any(j in lower_src for j in ['1x1', 'base64', 'sprite', 'icon', 'nav-', '.gif']):
                        return
                        
                    if abs_src not in seen_images:
                        seen_images.add(abs_src)
                        site_images.append(abs_src)

                # 1. Standard DOM attribute search
                for element in soup.find_all(['img', 'source']):
                    src = element.get('data-src') or element.get('data-original') or element.get('data-lazy-src') or element.get('srcset') or element.get('data-srcset') or element.get('src')
                    add_image(src)
                
                # 2. Aggressive regex search for hidden JSON blobs and custom attributes
                regex_urls = re.findall(r'https?(?::|\\\\u003a)?(?:/|\\\\/){2}[^\s\"\'<>;&\[\]\{\}]+\.(?:jpg|jpeg|png|webp)', html_content, re.IGNORECASE)
                for raw_url in regex_urls:
                    raw_url = raw_url.replace("\\/", "/").replace("\\u003a", ":").replace("\\U003A", ":")
                    add_image(raw_url)
                
                # Step 3: Output Format
                results.append({
                    "site_url": url,
                    "image_urls": site_images
                })

            return results

        # Phase 1: Fetch initial URL
        task.status = "scraping"
        task.progress = 30
        task.append_activity("scraping", f"Fetching HTML via Steel MCP from {task.url}")
        db.commit()

        try:
            html_content = fetch_via_steel_mcp(task.url)
        except Exception as e:
            raise Exception(f"Steel MCP fetch failed: {e}")

        # Compress HTML using BeautifulSoup
        soup = BeautifulSoup(html_content, "html.parser")
        for el in soup(["script", "style", "svg", "noscript", "header", "footer", "nav"]):
            el.extract()
            
        clean_text = soup.get_text(separator=" ", strip=True)
        
        # Manually extract images so LLM can see them
        unique_images = extract_all_images(html_content, task.url, soup)
        seen = set(unique_images)
        task.append_activity("scraping", f"Found {len(unique_images)} images on primary URL")
        db.commit()
                
        images_context = "\n".join(unique_images)

        task.status = "ai_processing"
        task.progress = 60
        task.raw_html = soup.prettify()
        task.append_activity("ai_processing", "HTML compressed, running extraction")
        db.commit()

        title = soup.find("meta", property="og:title")
        description = soup.find("meta", property="og:description")
        image = soup.find("meta", property="og:image")
        
        title_val = title["content"] if title else soup.title.string if soup.title else "Unknown Product"
        desc_val = description["content"] if description else clean_text[:200] + "..."
        img_val = image["content"] if image else ""

        visited_urls = [task.url]
        
        product_data = {}
        if deepseek_key and deepseek_key.strip():
            # ── Deepseek Worker Credit Check ──
            from app.services.credit_service import deepseek_worker_check
            ds_check = deepseek_worker_check()
            if ds_check["status"] == "block":
                raise Exception(f"Deepseek credits exhausted: {ds_check.get('reason')}")

            # --- PHASE A: SOURCE EXTRACTION VIA AGENT ---
            task.append_activity("ai_processing", "Running DeepSeek Agent to navigate and extract source_data")
            db.commit()
            
            from app.tasks.agent import run_steel_agent
            schema_instruction = """
            {
              "product_identity": {"brand": "", "product_name": "", "model": "", "sku": "", "upc": ""},
              "pricing_and_availability": {"price": "", "compare_at_price": "", "currency": "", "stock_status": true},
              "descriptions": {"short_description": "", "full_description": ""},
              "attributes": {"key": "value"},
              "features": ["feature 1"],
              "specifications": {"key": "value"},
              "breadcrumbs": ["Home"],
              "shipping_and_returns": {"shipping_info": "", "warranty_info": ""}
            }
            """
            agent_result = run_steel_agent(task.url, schema_instruction, "", deepseek_key)
            
            source_data = {}
            
            # Agent result might be enclosed in markdown JSON blocks
            clean_res = agent_result.replace("```json", "").replace("```", "").strip()
            try:
                source_data = json.loads(clean_res)
            except Exception as parse_e:
                # Fallback to standard extraction if agent failed to return pure JSON
                task.append_activity("ai_processing", f"Agent JSON parse failed ({parse_e}), falling back to text extraction")
                from app.tasks.source_extraction import extract_source_data
                source_data = extract_source_data(agent_result + "\n\n" + clean_text, unique_images, deepseek_key)
                
            task.source_data = source_data
            db.commit()
            
            product_name = source_data.get("product_identity", {}).get("product_name") or title_val
            
            # --- PHASE 3: Serper Competitor URLs ---
            serper_data = ""
            competitor_htmls = []
            if serper_key and serper_key.strip() and product_name:
                pi = source_data.get("product_identity", {})
                sku = pi.get("sku", "") or ""
                model = pi.get("model", "") or ""
                upc = pi.get("upc", "") or ""
                
                # Combine all available identifiers
                identifiers = " ".join([i for i in [sku, model, upc] if str(i).strip()])
                
                search_query = f"{product_name} {identifiers} specifications details".replace("  ", " ").strip()
                task.append_activity("ai_processing", f"Querying Serper for '{search_query}'")
                db.commit()
                try:
                    serper_resp = httpx.post(
                        "https://google.serper.dev/search",
                        headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                        json={"q": search_query}
                    )
                    serper_resp.raise_for_status()
                    organic_results = serper_resp.json().get("organic", [])
                    serper_data = json.dumps(organic_results[:3])
                    
                    urls_to_fetch = [item["link"] for item in organic_results if "link" in item][:3]
                    
                    if urls_to_fetch:
                        task.append_activity("scraping", f"Fetching {len(urls_to_fetch)} competitor URLs via Steel MCP")
                        db.commit()
                        
                        import concurrent.futures
                        def fetch_bb(u):
                            try:
                                c = fetch_via_steel_mcp(u)
                                s = BeautifulSoup(c, "html.parser")
                                
                                c_imgs = extract_all_images(c, u, s)
                                return (f"--- Competitor URL: {u} ---\nContent:\n{s.get_text(separator=' ', strip=True)[:10000]}", c_imgs, u)
                            except Exception as ex:
                                return (f"--- Competitor URL: {u} ---\nContent: Failed to fetch ({ex})", [], None)
                                
                        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                            results = list(executor.map(fetch_bb, urls_to_fetch))
                            for text, c_imgs, u in results:
                                competitor_htmls.append(text)
                                if u:
                                    visited_urls.append(u)
                                for img_str in c_imgs:
                                    if img_str not in seen:
                                        seen.add(img_str)
                                        unique_images.append(img_str)
                                        
                        # Update images_context with newly found competitor images
                        images_context = "\n".join(unique_images)
                        task.append_activity("scraping", f"Total unique images after competitors: {len(unique_images)}")
                        db.commit()
                            
                except Exception as se:
                    print(f"Serper/BrowserBase multi-fetch error: {se}")

            # Read the user's detailed system prompt
            system_prompt_path = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
            try:
                with open(system_prompt_path, "r", encoding="utf-8") as f:
                    system_prompt_text = f.read()
            except Exception as e:
                system_prompt_text = "You are a product enrichment agent."

            # --- PHASE B: AI ENRICHMENT ---
            task.append_activity("ai_processing", "Finalizing JSON with DeepSeek agent using combined context")
            db.commit()
            
            competitor_text = "\n\n".join(competitor_htmls)
            prompt2 = f"Source Data (Structured JSON):\n{json.dumps(source_data, indent=2)}\n\nFound Images:\n{images_context}\n\nExtra Search Context (Serper):\n{serper_data}\n\nCompetitor Content:\n{competitor_text}\n\nMerge the Competitor Content into the Source Data to enrich it, filling in any missing fields. Output the final JSON exactly as specified in the OUTPUT FORMAT."
            
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
                if not product_data.get("images") and img_val:
                    product_data["images"] = [img_val]
                    
                # Inject visited URLs into metadata
                if "enrichment_metadata" not in product_data:
                    product_data["enrichment_metadata"] = {}
                product_data["enrichment_metadata"]["visited_urls"] = visited_urls
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
                task.error_message = f"No reference image found. At least 2 valid scraped reference images are required for image generation. Found: {len(unique_urls)}."
                task.append_activity("Image_generation_blocked_no_reference_images", f"Image generation blocked: required = 2, found = {len(unique_urls)}")

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
