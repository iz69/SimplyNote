# Dockerでの導入・運用

公開イメージを使ってSimplyNoteを起動する手順です。DockerとDocker Composeが必要です。
対応プラットフォームは `linux/amd64` です。

## 導入

配置先のディレクトリを作り、Composeファイルと設定例を取得します。
`v1.1.1` は使用するリリースタグに置き換えてください。

```sh
mkdir simplynote
cd simplynote
SIMPLYNOTE_RELEASE=v1.1.1
curl -fL "https://raw.githubusercontent.com/iz69/SimplyNote/${SIMPLYNOTE_RELEASE}/docker-compose.yml" -o docker-compose.yml
curl -fL "https://raw.githubusercontent.com/iz69/SimplyNote/${SIMPLYNOTE_RELEASE}/.env.example" -o .env.example
cp .env.example .env
```

`.env` を編集し、管理者のID・パスワードと公開パスを設定します。

| 変数 | 用途・設定例 |
| --- | --- |
| `ADMIN_USER` / `ADMIN_PASS` | 管理者のID・パスワード。サンプルの値を変更してください |
| `UI_BASE_PATH` | UIの公開パス。`/simplynote/`。末尾に `/` を付けます |
| `API_BASE_PATH` | APIの公開パス。`/simplynote-api` |
| `SIMPLYNOTE_DATA_DIR` | データの保存先。既定は `./data` |
| `TZ` | タイムゾーン。`Asia/Tokyo` |
| `ENABLE_API` / `ENABLE_DRIVE` | ログイン画面にAPI・Google Drive接続を表示するか。`true` または `false` |

## nginxでの公開

標準の公開パスに合わせた設定例です。
ComposeはUIを `127.0.0.1:15173`、APIを `127.0.0.1:18888` に公開します。

```nginx
# SimplyNote API
location /simplynote-api/ {
    client_max_body_size 0;
    proxy_pass http://127.0.0.1:18888/;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# SimplyNote WebUI
location /simplynote/ {
    proxy_pass http://127.0.0.1:15173/;
}
```

別の公開パスにする場合は、`.env` とnginxの `location` を合わせて変更します。
`proxy_pass` の末尾の `/` は上の例のままにしてください。
`client_max_body_size 0` はアップロード容量を制限しません。上限を設ける場合は `60m` などに変更します。

## 起動

```sh
docker compose pull
docker compose up -d
```

ブラウザで `https://自分のホスト名/simplynote/` を開きます。
API接続を選び、設定した管理者のID・パスワードでログインしてください。

## 更新・設定変更

新しいイメージに更新するときは、次のコマンドを実行します。

```sh
docker compose pull
docker compose up -d
```

`.env` を変更した場合は `docker compose up -d` で反映します。
データは保存先のディレクトリに残ります。

Composeは `latest` を使います。バージョンを固定したい場合は、`docker-compose.yml` の
両サービスの `image` の末尾を `:1.1.1` などの公開済みバージョンに変更してください。
ポートを変更する場合は、Composeの `ports` とnginxの転送先を合わせて変更します。

## データとバックアップ

DB・添付ファイル・API設定は、既定でComposeファイルと同じ場所の `data` ディレクトリに保存します。
保存先を変える場合は、`.env` の `SIMPLYNOTE_DATA_DIR` を変更してください。

バックアップはAPIを停止して、保存先全体を取得します。標準の保存先の場合の例です。

```sh
docker compose stop api
tar -czf simplynote-data-backup.tar.gz data
docker compose start api
```

`.env` も保管してください。復元するときはAPIを停止し、保存先の内容をバックアップから戻します。

## 既存環境からの切り替え

切り替え前にAPIを停止し、データをバックアップしてください。
`.env` の管理者設定・公開パス・データ保存先には、これまで使っていた値を指定します。

従来の `api/data` を使い続ける場合は `SIMPLYNOTE_DATA_DIR=./api/data`、
`data` へ移動済みの場合は `SIMPLYNOTE_DATA_DIR=./data` を指定してください。
ログイン方法を `ui/config.json` で設定していた場合は、
`ENABLE_API`・`ENABLE_DRIVE` にその値を移します。

[ソースビルド・イメージ公開・テストの手順](container-development.md)は開発者向けドキュメントを参照してください。
