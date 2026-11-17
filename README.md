# Voice App

録音した声を VoiceStudio に登録し、その声で入力した文章を読み上げる Web アプリです。

[アプリを開く](https://ryuya-matsubara.github.io/voice-app/)

## 初回セットアップ

GitHub Pages の `main`、`/(root)` が画面を配信し、音声生成と登録済みの声の保存は VoiceStudio が担当します。以下は Windows PC で VoiceStudio を動かし、iPhone からも接続する手順です。

1. Windows PC に [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) を入れて起動します。PC と iPhone に [Tailscale](https://tailscale.com/download) を入れ、同じ Tailscale ネットワークに接続します。
2. Windows の PowerShell で、API キーを作成して VoiceStudio を起動します。

   ```powershell
   $voiceAppKeyBytes = [byte[]]::new(32)
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($voiceAppKeyBytes)
   $env:OMNIVOICE_API_KEY = [Convert]::ToBase64String($voiceAppKeyBytes)

   docker run -d --name voice-app-studio `
     -p 127.0.0.1:3900:3900 `
     -e OMNIVOICE_API_KEY `
     -e OMNIVOICE_DATA_DIR=/app/omnivoice_data `
     -e OMNIVOICE_SERVER_MODE=1 `
     -e "OMNIVOICE_ALLOWED_ORIGINS=http://localhost:3900,http://127.0.0.1:3900,https://ryuya-matsubara.github.io" `
     -v voice-app-studio-data:/app/omnivoice_data `
     ghcr.io/debpalash/voicestudio:0.5.8
   ```

   生成したキーで VoiceStudio の API を認証します。ポート `3900` は PC 内だけで待ち受け、録音とモデルは Docker ボリュームに保存します。許可オリジンは GitHub Pages のホスト名まで指定します。初回はモデルのダウンロードに時間がかかります。Windows が ARM64 の場合は [VoiceStudio の ARM64 向け Docker 手順](https://github.com/debpalash/VoiceStudio/blob/main/docs/install/docker.md)を参照してください。

3. Windows の PowerShell で `tailscale serve --bg 3900` を実行します。VoiceStudio に自分の Tailscale ネットワークから HTTPS で接続できるようになり、`https://…ts.net` が表示されます。HTTPS 設定の案内が表示されたら、その手順に従ってください。
4. [Voice App](https://ryuya-matsubara.github.io/voice-app/) を開き、表示された HTTPS URL と `$env:OMNIVOICE_API_KEY` の値を入力して接続します。PowerShell で `$env:OMNIVOICE_API_KEY` と入力すると、作成したキーを確認できます。キーは GitHub に保存せず、接続時にだけ入力してください。

## 使い方

1. マイクを許可して録音し、試聴してから名前を付けて登録します。
2. 登録した声を選び、文章を入力して「読み上げる」を押します。自動再生されない場合はプレーヤーの再生ボタンを押してください。

登録済みの声は、同じ VoiceStudio に接続すれば次回も選択できます。画面を再読み込みした場合は再接続が必要です。PC、Docker コンテナ、Tailscale が動作している間に利用できます。

[VoiceStudio の Docker 手順](https://github.com/debpalash/VoiceStudio/blob/main/docs/install/docker.md) · [VoiceStudio API の認証](https://github.com/debpalash/VoiceStudio/blob/main/docs/api-auth.md) · [Tailscale Serve](https://tailscale.com/kb/1312/serve)
