# Dockerイメージ配布

UI・APIをGHCRへ配布する。公開用Composeにビルド指定はなく、配置先にソース一式は不要。
対応プラットフォームは `linux/amd64`。
初回公開には、この変更をGitHubへ反映し、バージョンタグをpushする必要がある。
初回公開前の動作確認は、下記のソースビルド用Composeを使う。

| イメージ | 内容 |
| --- | --- |
| `ghcr.io/iz69/simplynote-ui` | React UI、nginx、起動時の設定生成 |
| `ghcr.io/iz69/simplynote-api` | FastAPI、SQLite、添付ファイル処理 |

## 導入と設定

公開済みリリースの `docker-compose.yml` と `.env.example` を同じディレクトリへ置く。
以下の `v1.1.0` は実際に公開されたリリースタグに置き換える。

```sh
mkdir simplynote
cd simplynote
SIMPLYNOTE_RELEASE=v1.1.0
curl -fL "https://raw.githubusercontent.com/iz69/SimplyNote/${SIMPLYNOTE_RELEASE}/docker-compose.yml" -o docker-compose.yml
curl -fL "https://raw.githubusercontent.com/iz69/SimplyNote/${SIMPLYNOTE_RELEASE}/.env.example" -o .env.example
cp .env.example .env
```

`.env` に公開パス、保存先、管理者設定を指定する。

| 変数 | 用途・既定値 |
| --- | --- |
| `UI_BASE_PATH` | UIの公開パス。既定は `/simplynote/` |
| `API_BASE_PATH` | APIの公開パス。既定は `/simplynote-api` |
| `SIMPLYNOTE_DATA_DIR` | DB・添付ファイル・API設定の保存先。`./api/data` |
| `TZ` | APIのタイムゾーン。`Asia/Tokyo` |
| `ADMIN_USER` / `ADMIN_PASS` | API管理者。サンプルの値を運用する値へ変更 |
| `ENABLE_API` / `ENABLE_DRIVE` | ログイン画面に表示する接続方法。どちらも `true` |

イメージタグとホスト側ポートはComposeに直接記載する。
配布用は既定で `latest` を使う。バージョンを固定する場合は、各サービスの `image` を
`ghcr.io/iz69/simplynote-api:1.1.0` のように公開済みのタグへ変更する。
ポートは両ComposeでUIが15173、APIが18888。変更する場合は `ports` を編集する。

`UI_BASE_PATH` は `/` で始まり、末尾にも `/` を付ける。ルート配置は `/`。
両サービスを同じComposeで動かす場合、`API_BASE_PATH` はURLではなく絶対パスを指定する。
UIコンテナ単体では、`API_BASE_PATH` に別オリジンのHTTP(S) URLを指定することもできる。
ログイン画面で利用者が保存したAPI接続先は、起動時の既定値より優先する。

```sh
docker compose pull
docker compose up -d
```

公開パスや機能表示を変更した場合も `docker compose up -d` でコンテナを再作成するだけでよい。
イメージの再ビルドは不要。`latest` の更新を取り込むときは、先に `docker compose pull` を実行する。

## プロキシと任意のサブパス

例えば、次の `.env` で同じイメージを複数階層へ配置できる。

```env
UI_BASE_PATH=/tools/notes/
API_BASE_PATH=/tools/notes-api
```

外側のnginxを次のように設定する。

```nginx
location = /tools/notes {
    return 308 /tools/notes/$is_args$args;
}
location /tools/notes/ {
    proxy_pass http://127.0.0.1:15173;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /tools/notes-api/ {
    client_max_body_size 60m;
    proxy_pass http://127.0.0.1:18888/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

UIは公開パスを保持して転送する。従来の公開パスを除く転送にも対応する。
APIは公開パスを除いて転送する。APIの `BASE_PATH` は公開URL情報の指定であり、
実際のルートは `/auth`・`/notes` などのまま。
UIを `/` に配置する場合も、APIを `/simplynote-api/` などに分けて転送できる。
UIコンテナはAPIを中継しないため、プロキシなしの確認ではログイン画面のAPI URLに
`http://localhost:18888` を指定する。

## ソースビルドと既存環境からの移行

リポジトリで `.env` を用意し、次の独立したComposeを使う。
公開用と同じ公開パス・ポート・データ保存先を使う。
この構成はDockerイメージのソースビルド用で、変更後に再ビルドする。

```sh
docker compose -f docker-compose.develop.yml up -d --build
```

既存環境から移行するときは、`.env` に現在と同じ管理者設定・公開パス・データ保存先を指定する。
ログイン画面の機能表示を `ui/config.json` で変更していた場合は、対応する
`ENABLE_API`・`ENABLE_DRIVE` にその値を移す。
API側の `/data/config.json` はDB・添付ファイルとともに継続利用する。

公開用・ソースビルド用は同じコンテナ名を使う。
切り替える際は、元の構成とプロジェクト名を指定してコンテナを停止・削除する。
APIを停止した状態で、保存先全体をバックアップする。永続データを削除するオプションは付けない。

```sh
# 従来の構成で停止する例
docker compose -f docker-compose.develop.yml down
# 保存先全体をバックアップした後、公開用へ切り替える
docker compose pull
docker compose up -d
```

従来どおりUIの `config.json` をマウントする場合は、次の
`docker-compose.override.yml` を追加する。このファイルはGit管理から除外している。
マウントした設定は環境変数による機能表示設定より優先し、HTML・公開パス設定は自動生成する。

```yaml
services:
  ui:
    volumes:
      - type: bind
        source: ./ui/config.json
        target: /usr/share/nginx/html/config.json
        read_only: true
        bind:
          create_host_path: false
```

公開用の `docker compose up -d` はこの上書きを自動で読む。
ソースビルド用では `-f docker-compose.develop.yml -f docker-compose.override.yml` を指定する。
マウントするJSONはオブジェクトで、`enableApi`・`enableDrive` を真偽値で指定する。
ファイル変更はログイン画面の再読み込みで反映する。

## メンテナーの公開手順

[container-images.yml](../.github/workflows/container-images.yml) はPR・mainへのpush・手動実行で
UI/APIイメージをビルドし、テストする。`v1.1.0` などのバージョンタグのpushでは、
両イメージの検証成功後にGHCRへ公開する。

```sh
# 変更をGitHubへ反映した後、未使用のバージョンタグを公開
git tag v1.1.0
git push origin v1.1.0
```

`v1.1.0` はイメージの `1.1.0` タグになる。安定版には `latest`、コミット識別用には
`sha-...` も付く。プレリリースは `latest` を更新しない。
初回公開後は、GitHubのPackages設定で両パッケージのVisibilityを `Public` にする。
GitHub Actionsの `GITHUB_TOKEN` で公開でき、Publicなイメージは利用者が匿名でpullできる。
詳細は[GitHub公式ドキュメント](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)を参照。

## 検証

UIは相対パスで一度ビルドする。起動時に公開パスを検証し、HTMLの `base`・設定JS・
機能表示設定・nginx設定を生成する。コンパイル済みJS/CSSは変更しない。
HTMLと設定ファイルは `no-store`、ハッシュ付きアセットは長期キャッシュで配信する。

```sh
cd ui
npm ci
npm run test:runtime
docker build -t simplynote-ui:distribution-test .
node node_modules/playwright-core/cli.js install --with-deps chromium
npm run test:container
```

コンテナ検証は同一イメージを6種類の公開パスで起動し、HTML・設定・JS/CSS・アイコン・
キャッシュ・末尾スラッシュ補完・存在しないアセットの404・再起動を確認する。
ブラウザではログイン・再読み込み・ホームへの遷移・深いURL・保存済みAPI接続先の優先を検証する。
API応答には架空のデータを使う。既存のUI設定マウントと設定エラーも確認する。
APIイメージは、一時的な `/data` で起動・ログイン・ノート作成/取得/更新・添付ファイルを検証する。
