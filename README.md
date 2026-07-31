# 有給手帳

有給休暇の残日数・失効管理・勤続年数を記録する個人用Webアプリ。
完全無料（Firebase無料枠 + GitHub Pages）で、PWA対応（ホーム画面に追加してアプリのように使える）。

- 画面：GitHub Pages（静的ホスティング、無料）
- データ保存：Firebase Firestore（Googleログインで、どの端末からでも同期）
- オフライン時：ブラウザのlocalStorageにも即保存されるので、ネットが無くても動く

---

## 1. Firebaseプロジェクトを作る

1. https://console.firebase.google.com/ を開き、「プロジェクトを追加」
2. プロジェクト名を入力（例：yukyu-techo）。Googleアナリティクスは不要なのでOFFでよい
3. 作成が終わったら、プロジェクトのトップ画面で **Authentication** を開き、「始める」→ サインイン方法で **Google** を有効化
4. 左メニューの **Firestore Database** を開き、「データベースの作成」。本番環境モードで開始（リージョンは `asia-northeast1`＝東京 がおすすめ）
5. Firestoreの「ルール」タブを開き、このプロジェクトに含まれる `firestore.rules` の内容を貼り付けて公開（本人のデータだけ読み書きできるようにする設定です）

## 2. Webアプリを登録してAPIキーを取得

1. プロジェクトのトップ画面の歯車アイコン →「プロジェクトの設定」
2. 「マイアプリ」→ `</>`（ウェブ）アイコンをクリックしてアプリを登録（Firebase Hostingは使わないのでチェック不要）
3. 表示される `firebaseConfig` の値を、このプロジェクト内の `.env.example` を `.env` にコピーしたファイルに転記する

```
cp .env.example .env
# .env を開いて値を埋める
```

この値は公開されても問題ない種類のものです（実際のデータ保護は手順1-5のFirestoreルールで行っています）。

## 3. ローカルで動作確認

```
npm install
npm run dev
```

表示されたURL（`http://localhost:5173` など）をブラウザで開いて、ログインや記録の追加ができるか確認してください。

## 4. GitHubに公開する

1. GitHubで新しいリポジトリを作成（例：`yukyu-techo`）。**プライベートでもPagesは無料で使えます**が、コード自体に個人情報は含まれないので迷ったらPublicで問題ありません
2. `vite.config.js` の `base` を、リポジトリ名に合わせて書き換える（例：`/yukyu-techo/`）。`public/manifest.json` の `start_url` と `scope` も同じ値に揃えてください
3. コードをpush

```
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/ユーザー名/yukyu-techo.git
git push -u origin main
```

4. リポジトリの **Settings → Pages** で、Source を「GitHub Actions」に設定
5. リポジトリの **Settings → Secrets and variables → Actions** で、`.env` に書いた6つの値をそれぞれ同じ名前（`VITE_FIREBASE_API_KEY` など）でSecretsとして登録
6. 上記のpushで自動的に `.github/workflows/deploy.yml` が動き、`https://ユーザー名.github.io/yukyu-techo/` に公開されます（Actionsタブで進捗確認可）

## 5. PWAとして使う

公開されたURLをスマホのブラウザで開き、

- iPhone（Safari）：共有ボタン →「ホーム画面に追加」
- Android（Chrome）：メニュー →「アプリをインストール」

これでホーム画面のアイコンから、ブラウザのアドレスバー無しでアプリのように起動できます。オフラインでも直近の記録は表示・追加でき、ネットに繋がった時にFirestoreへ同期されます。

## 6. 使い方のメモ

- 初回にログインすると、その時点の記録がFirestoreにアップロードされます。他の端末で同じGoogleアカウントでログインすると、そちらのデータで上書きされる仕様なので、複数端末で同時に編集するのは避けてください
- ログインしなくても単体のブラウザ内では使えます（localStorageのみ保存、同期はされません）
- データが心配な場合は、ブラウザの開発者ツール（Application → Local Storage）から `yukyu-techo-data-v1` の値を手動でコピーしておくこともできます

## 困ったとき

- **ログインのポップアップがブロックされる**：ブラウザのポップアップブロック設定を確認してください
- **Firestoreへの保存が失敗する**：手順1-5のルールが正しく公開されているか、`.env` の値が正しいか確認してください
- **アイコンやタイトルを変えたい**：`public/icon-192.png` / `icon-512.png` を差し替え、`public/manifest.json` の `name` を編集してください
