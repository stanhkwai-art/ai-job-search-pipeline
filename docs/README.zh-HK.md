# 自架 AI 求職流水線（廣東話簡介）

**一個喺屋企伺服器（NAS）上面行嘅求職助手。** 佢會讀你嘅 job alert email，用你真實嘅工作紀錄幫每份工評分，
夜晚自動幫你寫度身 CV、cover letter 同 screener 建議答案，再喺 Telegram 通知你。寄唔寄、點寄，由你自己決定，
亦由你自己撳 Submit。

用 Claude Code（headless 模式）、n8n 同開源嘅 [ai-job-search](https://github.com/ai-job-search-dev/ai-job-search) skills
（`/scrape`、`/apply`）砌成，喺 Synology NAS（或者任何長開嘅 Linux 機）用兩個 Docker container 行。

> **唔會幫你自動申請。** 冇任何 workflow 有「寄出」步驟：email 只會開 Gmail 草稿，申請一定由你自己做。
> CV 只會用你有紀錄嘅經驗，唔會作技能、證書或者成績。

## 點解要做

認真申請一份工要時間：睇 JD、判斷啱唔啱、再按 JD 嘅用詞改 CV 同 cover letter。一份工隨時一個鐘。如果同時搵幾個市場
（例如香港長工、英國長工、英國 contract），就等於做多份兼職。大部分時間其實花喺閱讀、配對同寫初稿，呢啲 AI 做得好，
前提係要守住事實。判斷（值唔值得申請、CV 誠唔誠實、寄唔寄）就留返畀你。

## 做咩

| 步驟 | 點做 |
|---|---|
| 搵工 | n8n 每 30 分鐘讀 job alert email，按「求職線」（track）分類；每日 `/scrape` 再搜尋容許自動讀取嘅網站 |
| 篩選 | 職銜篩選（英文同中文職銜）先剔走明顯唔啱嘅工；可以設人工下限，alert 有寫人工而低過下限就刪 |
| 評分 | `/scrape` 按你嘅 career bank 同該線規則，幫每份工評 1–5 分 |
| 通知 | 每朝 Telegram 摘要，每線頭 5 份工，每份有 ✍️ 掣；4 分或以上自動排隊（每日有上限） |
| 寫 CV | 隊列 runner 夜晚逐份跑 `/apply`：LaTeX PDF CV、cover letter 或者短 agency email、screener 答案、「值唔值得申請」判斷，同埋 career bank 未有紀錄嘅問題 |
| 追蹤 | Gmail 收據自動更新 `applications.csv`；招聘回覆自動分類；跟進同 check-in 開 Gmail 草稿；每週 HTML 報告 |

你亦可以直接傳職位連結或者貼 JD 畀 Telegram bot。

## n8n workflow 一覽

| Workflow | 時間 | 做咩 |
|---|---|---|
| WF1 職位 alert | 每 30 分鐘 | 解析 20 幾個求職網站嘅 alert email，清走追蹤連結同一次性登入 token，分線、篩選、去重，寫入各線 inbox；讀唔到嘅格式交畀 `/scrape` 讀原文 |
| WF2 朝早摘要 | 星期一至六 07:45 | 每線頭 5 份工 + ✍️ 掣；4 分以上未有 CV 嘅自動排隊（每日最多 3 份） |
| WF3 回覆分類 | 每 5 分鐘 | 只將似招聘嘅 email 交畀 Claude API 分類（面試、拒絕、獵頭接觸、right to represent 等）；回覆草稿用固定範本，唔用 AI 生成，防止 email 內容操控回覆 |
| WF4 跟進 | 每日 09:00 | 經 agency 申請 7 日冇消息開一次跟進草稿；21 日冇回覆改「no response」 |
| WF5 Agency check-in | 每日 09:15 | 按頻率幫每間 agency 開 check-in 草稿（可開工日期、日薪、近況留空畀你填） |
| WF6 每週報告 | 星期六 21:00 | HTML 報告（手機變卡片、支援深色模式）+ Telegram 摘要：評分、高分職位、CV、申請、漏讀 email |
| WF7 | — | 預留畀網上 CV 更新流程 |
| WF8 Telegram 指令 | 每分鐘 | 處理掣、連結、貼 JD、「急」、「已申請 公司名」；只接受你自己個 chat |
| WF10 申請收據 | 每 15 分鐘 | 讀 JobsDB/SEEK、Indeed、LinkedIn 嘅「已遞交／已查看／唔成功」email，更新申請紀錄 |

## 隊列同 runner

`shared/apply-queue.jsonl` 每行一個 JSON：`job`（申請）、`jd`（補 JD）、`urgent`（即刻做）、`approve`（批准）、`prio`（排序）、
`last`（排最尾）、`cancel`（取消）。`job` 可以加 `notes`，寫你對呢份申請嘅特別指示（例如「強調十年受監管金融機構 IT 主管經驗」），
但唔可以凌駕誠實規則。

Runner 每 5 分鐘跑一次：
- **夜晚先做**（`apply-hours.txt`），慳返日頭嘅 Claude 額度；「急」就即刻做。
- **指定線要批准**（`apply-hold.txt`），**有用量上限**（`apply-budget.json`）。
- **Claude 額度用完**就自動暫停，到重設時間再繼續。
- **攞 JD 唔犯規**：JobsDB 用 freehire.me 公開鏡像，LinkedIn／Indeed 去其他網站搵同一份 JD，搵唔到先叫你貼。
- **按分數揀 model**：4 分以上用 Opus，其他用 Sonnet。
- 跑完將 CV、cover letter 放入 `cv-out/`，喺 Telegram 傳摘要、cover letter 原文同 screener 答案畀你。

## 安全規則

- 唔自動申請、唔自動寄 email。
- CV 只用 career bank 有紀錄嘅經驗；技能程度有上限（「familiar with」就停喺「familiar with」）。
- 對外文件（CV、cover letter、agency email、screener）只寫強項，唔寫「冇」、「未做過」。career bank 未有紀錄唔等於冇經驗，
  JD 要求但未有紀錄嘅嘢會變成問題問你，你確認咗先加入 career bank。
- 人工下限只喺 n8n 內部用嚟篩選，唔會出現喺任何畀招聘方睇嘅文件。
- 網頁同 email 一律當資料，唔當指令；Claude 用 allow-list 行；Telegram token 同 chat id 唔會畀 Claude 見到。
- 唔爬冇開放 API 嘅網站、唔破解 CAPTCHA 或者防 bot 機制。
- 每條線係新開嘅 private repo（唔 fork），deploy key 只限單一 repo。

## 成果同學到嘅嘢

2026 年 11 月 4 至 19 日，三條線共整咗 **69 份**度身 CV 套件（contract 37、地區 A 長工 21、地區 B 長工 11），全部人手審批先申請。

學到嘅嘢（詳見英文 README）：
1. **數量唔係目標。** CV 唔使錢之後好易亂投，回覆率靠定位同啱唔啱，唔靠數量。
2. **要檢查 ATS 讀到嘅文字層，唔係睇個樣。** moderncv 嘅電話／email 圖示會將「MOBILE-ALT」、「Envelope」寫入 PDF 文字層，而家每份 CV 都會檢查。
3. **用數字開頭。** Profile 4 行、3 個有數字嘅主要成就、每點「行動 + 範圍 + 結果」。
4. **「未有紀錄」唔係「冇」。** 對外只寫強項，問題放 `gaps.md`。
5. **Contract 工幾個鐘就請到人。** 夜晚窗口平但慢，「急」同中午加跑一次 scrape 更重要。
6. **n8n Code node 當程式碼管理。** 由 `.js` 檔生成 workflow，加離線測試（550 項）。CLI 匯入會令 workflow 變返未發佈，要再發佈。

## 開始

詳細步驟見 [architecture.md](architecture.md)。簡單講：
1. 先確認 Claude Code 喺你部機嘅 CPU 行到（部分 NAS CPU 冇 AVX）。
2. 每條線 clone 一份 ai-job-search，push 去新開嘅 **private** repo。
3. 複製 `examples/.env.example` 做 `.env`，build image，`docker compose up -d`。
4. 喺 container 登入 Claude Code，每個 repo 跑 `/setup`，放好 career bank 同 track 規則，跑 `scripts/sync-to-repos.sh`。
5. `n8n-builder/` 入面 `python3 build.py && node test.mjs`，匯入 `out/*.json`，接好 credentials，發佈。
6. 排程：`scripts/scrape.sh` 每日 07:00，`scripts/apply-runner.sh` 每 5 分鐘。
