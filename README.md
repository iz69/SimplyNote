# SimplyNote
A lightweight, privacy-focused note-taking ecosystem inspired by Simplenote.

## 🌟 Philosophy
I wanted a Simplenote-like experience where I truly own my data. SimplyNote allows you to store your notes on your own API server or Google Drive, ensuring no third-party (including me!) ever sees your content.

自鯖にsimplenoteぽいのを入れたくて自分用に作ったもの。データの保管先は自鯖(APIサーバ) or Google Drive<br/>
気が向いたときに更新。永遠に開発中。

## 🚀 Components
- **SimplyNote-API**: The backbone. A lightweight API server using **SQLite3**.
- **WebUI**: A clean web interface to manage notes from any desktop browser.
- **SimplyNote-App (Android)**: [Get it on Google Play](https://play.google.com/store/apps/details?id=com.kuromaru_fx.simplynote)
- **SimplyNote-Vim**: For the terminal enthusiasts. [GitHub Link](https://github.com/iz69/SimplyNote_vim)

<img width="623" height="438" alt="image" src="https://github.com/user-attachments/assets/71b6f066-bd67-4e30-ae2b-09229518a4a1" />

## 🛠 Tech Stack & Setup
- **Backend**: Python / SQLite3
- **Deployment**: Docker & Docker Compose
- **Recommended Proxy**: Nginx (via `proxy_pass`)
- **Security Note**: Designed to be used within a **VPN** or behind strict web access controls.

## Docker配布と起動

`docker-compose.yml` はGHCRの公開イメージを使用し、利用者側でのビルドは不要です。
公開パスはコンテナ起動時に設定するため、`/` や複数階層のサブパスでも同じイメージを使えます。

| ファイル | 用途 |
| --- | --- |
| `docker-compose.yml` | 公開イメージから起動 |
| `docker-compose.develop.yml` | 手元のソースをビルドして起動 |
| `.env.example` | 両構成で使う設定のサンプル。`.env` にコピーして編集 |

```sh
cp .env.example .env
# .env の管理者設定・公開パス・保存先を編集
docker compose pull
docker compose up -d
```

ソースからビルドする場合:

```sh
docker compose -f docker-compose.develop.yml up -d --build
```

既定の公開パスはUIが `/simplynote/`、APIが `/simplynote-api`、
ホスト側ポートはそれぞれ15173・18888です。ホストの127.0.0.1へ公開します。
DB・添付ファイル・API設定は、既定で `./data:/data` に保存します。
導入・プロキシ設定・既存環境からの移行・イメージ公開の詳細は
[Dockerイメージ配布](docs/container-distribution.md) を参照してください。

**WebUI**<br/>
<img width="202" height="333" alt="image" src="https://github.com/user-attachments/assets/090f2537-3617-44ea-91de-bf931aa4ac33" />
<img width="608" height="373" alt="Screenshot_web_20260124-091209" src="https://github.com/user-attachments/assets/dcf7a4c4-adf8-4846-a8fd-86894b112c00" />
<br/>
**Android App**</br>
<img width="160" height="323" alt="Screenshot_20260124-100612" src="https://github.com/user-attachments/assets/a666a3d8-d98b-42f2-bdaa-33507f351eb2" />
<img width="160" height="323" alt="Screenshot_20260124-091209" src="https://github.com/user-attachments/assets/3605659c-0626-4092-9c84-ebfed1a60863" />
<br/>
**vim plugin**</br>
<img width="225" alt="SimplyNote_vim" src="https://github.com/user-attachments/assets/eeb41852-6d84-40a1-ba92-8e06f5c01caa" />

## 📜 License
Copyright (c) 2025 Kuromaru Soft
- **Free for personal and non-commercial use.**
- **Commercial use is prohibited** without prior permission (this includes business use, resale, or integration into paid services).
- For commercial inquiries, please contact.

本ソフトウェアは、個人または非商用目的に限り、無償で使用・改変・再配布を許可します。<br/>
商用目的（直接・間接を問わず利益を得る目的）での利用は禁止します。<br/>

以下の行為を「商用利用」とし、事前の許諾なしに行うことを禁止します。<br/>
- 有償での提供、販売、再販
- 有料サービス・課金機能への組み込み
- 企業・組織での業務利用（社内利用を含む）
- 本ソフトウェアを利用したホスティング/運用代行の提供

商用利用を希望する場合はご連絡ください。<br/>
本ソフトウェアは現状のまま提供され、いかなる保証もありません。<br/>
作者は本ソフトウェアの利用により生じた損害について責任を負いません。<br/>

## 💖 Support & Donation
GitHub Sponsors: github.com/sponsors/iz69
