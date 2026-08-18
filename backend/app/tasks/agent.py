import asyncio
import json
import logging
from litellm import completion
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

def run_steel_agent(target_url: str, schema_str: str, project_id: str, deepseek_key: str):
    """
    Run an agent loop with Deepseek that uses Steel MCP tools locally.
    """
    messages = [
        {"role": "system", "content": "You are a web scraping agent. You have tools provided by the Steel browser MCP server. First, use `steel_scrape` to read the target URL as markdown. Once you have the content, use the `finish_extraction` tool to output the extracted data that EXACTLY matches the user's requested JSON schema. If the site requires interaction to see the data, you can use `steel_session_create` and `steel_act`. Your final goal is to call `finish_extraction`."},
        {"role": "user", "content": f"URL: {target_url}\n\nPlease navigate to this URL, read the content, and use the `finish_extraction` tool to return the product information according to this schema:\n{schema_str}"}
    ]
    
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
            
            import sys
            async with stdio_client(params, errlog=sys.__stderr__) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    
                    mcp_tools_resp = await session.list_tools()
                    
                    tools_for_llm = []
                    for t in mcp_tools_resp.tools:
                        tools_for_llm.append({
                            "type": "function",
                            "function": {
                                "name": t.name,
                                "description": t.description,
                                "parameters": getattr(t, "inputSchema", getattr(t, "input_schema", {}))
                            }
                        })
                        
                    tools_for_llm.append({
                        "type": "function",
                        "function": {
                            "name": "finish_extraction",
                            "description": "Call this tool with the final extracted JSON data that matches the requested schema.",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "extracted_json": {
                                        "type": "string",
                                        "description": "The extracted data as a valid JSON string"
                                    }
                                },
                                "required": ["extracted_json"]
                            }
                        }
                    })
                    
                    for _ in range(10):
                        resp = completion(model="deepseek/deepseek-chat", messages=messages, tools=tools_for_llm, api_key=deepseek_key)
                        msg = resp.choices[0].message
                        messages.append(msg.model_dump())
                        
                        if getattr(msg, "tool_calls", None):
                            for tc in msg.tool_calls:
                                func_name = tc.function.name
                                args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                                
                                if func_name == "finish_extraction":
                                    logger.info(f"Agent finished extraction: {args.get('extracted_json')}")
                                    return args.get("extracted_json")
                                
                                try:
                                    logger.info(f"Agent calling MCP tool: {func_name} with {args}")
                                    res = await session.call_tool(func_name, arguments=args)
                                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": str(res.content)})
                                except Exception as tool_e:
                                    logger.error(f"Tool {func_name} failed: {tool_e}")
                                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": f"Error: {tool_e}"})
                        else:
                            return msg.content
                            
                    return "Error: Agent loop exceeded maximum turns."
        except Exception as e:
            return f"Agent Error: {e}"

    return asyncio.run(_run())
