"""
gen_script.py — 用 LLM 自動生成 narration + slides_prompts + cover prompt
用法：python3 scripts/gen_script.py "主題" [project_dir]
輸出：narration.json, slides_prompts.json, cover_prompt.txt
"""
import sys, os, json, re, requests

def load_config(project_dir):
    p = os.path.join(project_dir, "config.json")
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def load_reference(project_dir, filename):
    for base in [project_dir, os.path.join(os.path.dirname(__file__), "..")]:
        p = os.path.join(base, "video-production-skill", "references", filename)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read()
        p = os.path.join(base, "references", filename)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read()
    return ""

def chat_completion(cfg, system_prompt, user_prompt, temperature=0.7):
    url = f"{cfg['chat']['baseURL']}/chat/completions"
    headers = {"Content-Type": "application/json", "User-Agent": "HermesAgent/1.0"}
    api_key = os.environ.get("OPENCODE_GO_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    else:
        print("⚠️  OPENCODE_GO_API_KEY 未設定。嘗試無認證請求...")
        print("   設定方式：export OPENCODE_GO_API_KEY=你的金鑰")
        print("   或從 ~/.hermes/.env 載入：source ~/.hermes/.env")
    payload = {
        "model": cfg["chat"]["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": temperature
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=180)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

def build_system_prompt(project_dir):
    style = load_reference(project_dir, "teaching-style.md")
    narr = load_reference(project_dir, "narration-style.md")
    return f"""你是一個專業的 AI 教學影片腳本作家。你需要根據給定的主題，
生成一組完整的教學影片腳本，包含旁白文字和投影片生成 prompt。

## 教學風格憲法

{style}

## 旁白寫作規則

{narr}

## 硬性規則（不可違反）

1. 旁白：每條「嚴格」80–150 字（繁體中文）。低於 80 字絕對不可接受，高於 150 字必須拆成兩條。
   口語化，用比喻、反問、幽默。若內容不足以達到 80 字，加一個生活化的例子、比喻、或反問句來擴充，不要用填充詞灌水。
   生成後自行計算每條字數，低於 80 字的條目直接重寫。
2. 投影片：每條對應一條旁白，條數必須完全相等
3. 一張投影片一個概念，不塞太多
4. 英文縮寫改中文或加句點（LLM → 大語言模型，或 L.L.M.）
5. 數字寫成中文（135000 → 十三萬五千）
6. 長句拆短（< 50 字），在自然呼吸點斷句
7. 避免破音字（還/重/長/得…），必要時換詞
8. 開場要吸引注意力，結尾要有 call to action
9. 投影片 prompt 中，必須出現在畫面上的中文字用「」包裹
10. 每條投影片 prompt 結尾加：「所有中文字必須完全正確、清楚可讀、不可有亂碼或錯字。數字要正確。」
11. 投影片風格：白底手繪教學風，粗黑標題左上，細線箭頭，大量留白，角落小吉祥物
12. 8-12 張投影片
13. 若有表格數字，明確指定「畫面只能出現 X 這幾個數字，其他留空」

## 輸出格式

嚴格輸出以下 JSON，不要加 markdown code fence，不要加任何說明文字：

{{
  "narration": [
    "第一張投影片的旁白文字...",
    "第二張投影片的旁白文字..."
  ],
  "slides_prompts": [
    "第一張投影片的生成 prompt...",
    "第二張投影片的生成 prompt..."
  ],
  "cover_prompt": "封面圖片生成 prompt..."
}}"""

def build_user_prompt(topic):
    return f"""請為以下主題生成一支教學影片的完整腳本：

主題：{topic}

要求：
- 8-12 張投影片
- 旁白用繁體中文
- 確保 narration 和 slides_prompts 條數完全相等
- ⚠️ 每條旁白必須嚴格在 80-150 字之間，生成後自行檢查字數，不合格的條目重寫
- 封面要包含主標題（用「」包裹）
- 封面風格與投影片一致（白底手繪教學風）

直接輸出 JSON，不要加任何說明。"""

def check_heteronyms(narration, project_dir):
    raw = load_reference(project_dir, "heteronyms.json")
    if not raw:
        return []
    hets = json.loads(raw)
    warnings = []
    for i, text in enumerate(narration):
        for char in hets:
            if char in text:
                warnings.append(f"Slide {i+1}: 含破音字「{char}」→ 建議確認或換詞")
    return warnings

def check_tts_safe(narration):
    warnings = []
    for i, text in enumerate(narration):
        if len(text) > 150:
            warnings.append(f"Slide {i+1}: 旁白 {len(text)} 字，超過 150 字上限")
        if len(text) < 80:
            warnings.append(f"Slide {i+1}: 僅 {len(text)} 字，低於 80 字下限 ← 請務必擴充")
        nums = re.findall(r'\b\d{2,}\b', text)
        if nums:
            warnings.append(f"Slide {i+1}: 含阿拉伯數字 {nums} → 建議改中文數字")
        abbr = re.findall(r'\b[A-Z]{2,}\b', text)
        if abbr:
            warnings.append(f"Slide {i+1}: 含英文縮寫 {abbr} → 建議改中文或加句點")
    return warnings

def expand_short_narration(text, cfg, system_prompt, target_min=80, target_max=150):
    """用 LLM 擴充過短的旁白到 80-150 字"""
    expand_prompt = f"""以下旁白只有 {len(text)} 字，低於 {target_min} 字下限。
請擴充到 {target_min}–{target_max} 字，保持原意不變，加一個生活化的例子或比喻來充實內容。
只輸出擴充後的文字，不要加任何說明。

原文：{text}"""
    result = chat_completion(cfg, system_prompt, expand_prompt, temperature=0.5)
    result = result.strip().strip('"').strip()
    if len(result) < target_min:
        result = text + "。" + result  # fallback: 串接
    return result

def main():
    if len(sys.argv) < 2:
        print("用法: python3 scripts/gen_script.py \"主題\" [project_dir]")
        sys.exit(1)
    topic = sys.argv[1]
    project_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    cfg = load_config(project_dir)
    print(f"主題：{topic}")
    print(f"模型：{cfg['chat']['model']}")
    print("生成中...", flush=True)
    system_prompt = build_system_prompt(project_dir)
    user_prompt = build_user_prompt(topic)
    raw = chat_completion(cfg, system_prompt, user_prompt)
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"LLM 輸出 JSON 解析失敗：{e}")
        print(f"原始輸出前 500 字：{raw[:500]}")
        sys.exit(1)
    narration = data["narration"]
    slides = data["slides_prompts"]
    cover = data["cover_prompt"]
    assert len(narration) == len(slides), \
        f"MISMATCH: narration={len(narration)} slides={len(slides)}"

    # 自動補字：擴充低於 80 字的旁白
    short_indices = [(i, t) for i, t in enumerate(narration) if len(t) < 80]
    if short_indices:
        print(f"\n📝 發現 {len(short_indices)} 條低於 80 字，自動擴充中...")
        for i, text in short_indices:
            print(f"  Slide {i+1}: {len(text)} 字 → ", end="", flush=True)
            narration[i] = expand_short_narration(text, cfg, system_prompt)
            print(f"{len(narration[i])} 字")
        still_short = [i+1 for i, t in enumerate(narration) if len(t) < 80]
        if still_short:
            print(f"\n⚠️  擴充後仍有 {len(still_short)} 條低於 80 字：slide {still_short}")
            print("   建議手動檢查 narration.json")
        else:
            print("\n✅ 全部擴充完成，每條 ≥ 80 字")

    with open(os.path.join(project_dir, "narration.json"), "w", encoding="utf-8") as f:
        json.dump(narration, f, ensure_ascii=False, indent=2)
    with open(os.path.join(project_dir, "slides_prompts.json"), "w", encoding="utf-8") as f:
        json.dump(slides, f, ensure_ascii=False, indent=2)
    with open(os.path.join(project_dir, "cover_prompt.txt"), "w", encoding="utf-8") as f:
        f.write(cover)
    print(f"\n✅ 生成完成：{len(narration)} 張投影片")
    print(f"   narration.json")
    print(f"   slides_prompts.json")
    print(f"   cover_prompt.txt")
    warnings = []
    warnings.extend(check_heteronyms(narration, project_dir))
    warnings.extend(check_tts_safe(narration))
    if warnings:
        print(f"\n⚠️  發現 {len(warnings)} 個潛在問題：")
        for w in warnings:
            print(f"   {w}")
        print("   建議手動檢查並修改 narration.json\n")
    else:
        print("\n✅ 破音字 + TTS 安全性檢查通過")
    print(f"下一步：")
    print(f"   python3 scripts/slides_gen.py --dir {project_dir}")
    print(f"   node scripts/tts_with_asr.js {project_dir}")

if __name__ == "__main__":
    main()
