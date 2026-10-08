# コンテナの開発・公開

利用者向けの導入・更新手順は [Dockerでの導入・運用](container-distribution.md) を参照してください。
このページはソースからのビルド、設定の仕組み、検証、イメージ公開を扱います。

## ソースからビルドする

リポジトリで `.env` を用意し、開発用Composeを使います。
公開用と同じ公開パス・ポート・データ保存先を使います。
UIも静的ファイルをビルドして配信する構成なので、ソース変更後は再ビルドします。

```sh
cp .env.example .env
# .env の管理者設定・公開パス・保存先を編集
docker compose -f docker-compose.develop.yml up -d --build
```

公開用・開発用は同じコンテナ名とポートを使います。
切り替えるときは同じComposeプロジェクト名・配置先を使ってください。
別の配置先で同時に起動する場合は、コンテナ名・ポートを変更します。

## 起動時の設定

UIは相対パスでビルドし、起動時にHTMLの `base`、設定JS、機能表示設定、nginx設定を生成します。
コンパイル済みJS/CSSは変更しません。
HTMLと設定ファイルは `no-store`、ハッシュ付きアセットは長期キャッシュで配信します。

公開パスの生成処理は [generate_config.py](../ui/runtime/generate_config.py) にあります。
UIは公開パスを保持した転送と、公開パスを取り除いた転送の両方に対応します。
nginxの `proxy_pass` 末尾に `/` を付けると公開パスを取り除き、付けないと保持します。

APIは公開パスを取り除いて転送します。APIの `BASE_PATH` は公開URL情報の指定であり、
実際のルートは `/auth`・`/notes` などです。
UIコンテナはAPIを中継しません。プロキシなしの確認ではログイン画面のAPI URLに
`http://localhost:18888` を指定します。
UIコンテナ単体では、`API_BASE_PATH` に別オリジンのHTTP(S) URLも指定できます。
ログイン画面で利用者が保存したAPI接続先は、起動時の既定値より優先します。

## 既存UI設定ファイルとの互換性

ログイン方法の表示は通常 `ENABLE_API`・`ENABLE_DRIVE` で設定します。
従来の `ui/config.json` のマウントも、互換性のために使えます。
マウントした設定は環境変数より優先します。

`docker-compose.override.yml` の例です。

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

公開用の `docker compose up -d` はこの上書きを自動で読みます。
開発用では `-f docker-compose.develop.yml -f docker-compose.override.yml` を指定します。
JSONはオブジェクトで、`enableApi`・`enableDrive` を真偽値で指定します。
ファイル変更はログイン画面の再読み込みで反映します。

## 検証

UIの起動時設定と、同じイメージを複数の公開パスで使う動作を検証します。

```sh
cd ui
npm ci
npm run test:runtime
docker build -t simplynote-ui:distribution-test .
node node_modules/playwright-core/cli.js install --with-deps chromium
npm run test:container
```

コンテナ検証は6種類の公開パスで、HTML・設定・JS/CSS・アイコン・キャッシュ・
末尾スラッシュ補完・存在しないアセットの404・再起動を確認します。
ブラウザではログイン・再読み込み・ホームへの遷移・深いURL・保存済みAPI接続先の優先を検証します。
API応答には架空のデータを使います。既存のUI設定マウントと設定エラーも確認します。

APIの検証はリポジトリのルートで実行します。一時的な `/data` を使います。

```sh
docker build -t simplynote-api:distribution-test api
docker run --rm --network none --tmpfs /data \
  -v "$PWD/api/tests/container_smoke.py:/smoke.py:ro" \
  -e BASE_PATH=/tools/notes-api -e ADMIN_USER=smoke-user -e ADMIN_PASS=smoke-password \
  --entrypoint python simplynote-api:distribution-test -B /smoke.py
```

起動・公開パス・ログイン・ノート作成/取得/更新・添付ファイルを検証します。

## イメージを公開する

[container-images.yml](../.github/workflows/container-images.yml) はPR・mainへのpush・手動実行で
UI/APIをビルドして検証します。バージョンタグのpushでは、両イメージの検証成功後にGHCRへ公開します。

変更をコミットしてmainへpushした後、未使用のバージョンを指定してタグを公開します。
以下は次のリリースを `1.1.2` とする場合の例です。

```sh
git push origin main
RELEASE_VERSION=1.1.2
git tag -a "v${RELEASE_VERSION}" -m "SimplyNote ${RELEASE_VERSION}"
git push origin "v${RELEASE_VERSION}"
```

`v1.1.2` はイメージの `1.1.2` タグになります。安定版には `latest`、コミット識別用には
`sha-...` も付きます。プレリリースは `latest` を更新しません。
公開済みのバージョンタグは保持し、変更は新しいバージョンとして公開します。

| イメージ | 内容 |
| --- | --- |
| `ghcr.io/iz69/simplynote-ui` | React UI、nginx、起動時の設定生成 |
| `ghcr.io/iz69/simplynote-api` | FastAPI、SQLite、添付ファイル処理 |

初回公開後はGitHubのPackages設定で、両パッケージのVisibilityを `Public` にします。
GitHub Actionsの `GITHUB_TOKEN` で公開でき、Publicなイメージは利用者が匿名でpullできます。
詳細は [GitHub公式ドキュメント](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) を参照してください。
