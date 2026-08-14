import os
import json
from litellm import completion

def extract_source_data(clean_text: str, extracted_images: list, deepseek_key: str) -> dict:
    """
    Takes raw HTML text and an authoritative list of image URLs.
    Uses DeepSeek to map the HTML into the predefined source_data schema.
    Guarantees that ALL extracted images are injected into the final JSON.
    """
    system_prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "source_extraction_system.txt")
    try:
        with open(system_prompt_path, "r", encoding="utf-8") as f:
            system_prompt_text = f.read()
    except Exception as e:
        print(f"Could not load source_extraction_system.txt: {e}")
        system_prompt_text = "You are a factual source extraction agent. Output JSON only."

    prompt = f"Source HTML Text:\n\n{clean_text[:15000]}\n\nExtract strictly into the predefined schema."
    
    try:
        ai_resp = completion(
            model="deepseek/deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt_text},
                {"role": "user", "content": prompt}
            ],
            api_key=deepseek_key,
            response_format={"type": "json_object"}
        )
        source_data = json.loads(ai_resp.choices[0].message.content)
    except Exception as e:
        print(f"Source Extraction LLM Error: {e}")
        # Fallback empty schema
        source_data = {
            "product_identity": {},
            "pricing_and_availability": {},
            "descriptions": {},
            "attributes": {},
            "features": [],
            "specifications": {},
            "breadcrumbs": [],
            "shipping_and_returns": {},
            "other_source_information": {},
            "error": str(e)
        }
        
    # Programmatic Image Injection Guarantee
    # We create a dedicated images block and inject the authoritative list from the scraper.
    image_objects = []
    for img_str in extracted_images:
        # Expected format: "Image: https://... | Alt: ..."
        parts = img_str.split(" | Alt: ")
        url_part = parts[0].replace("Image: ", "").strip()
        alt_part = parts[1].strip() if len(parts) > 1 else ""
        
        if url_part:
            image_objects.append({
                "url": url_part,
                "alt": alt_part,
                "type": "scraped"
            })
            
    source_data["images"] = {
        "all_scraped_images": image_objects
    }

    return source_data
