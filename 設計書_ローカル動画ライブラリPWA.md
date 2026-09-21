# 設計書: ローカル動画ライブラリ PWA

## 1. 目的

本アプリは、ユーザーの端末上に保存されている動画フォルダを、ブラウザだけで高速に閲覧、再生、整理するためのローカルファースト PWA である。特に、古いミュージックビデオの大規模アーカイブを対象に、サブフォルダを分類軸として扱い、検索、ソート、フォルダ単位の連続再生、リネーム、移動、削除を安全に行えることを目的とする。

動画ファイルはユーザーの端末内に残す。アプリはローカルファイルをアップロードせず、ローカル動画データを Cache Storage に保存せず、一時的な object URL で再生とサムネイル生成を行う。

## 2. スコープ

### 2.1 対象範囲

- ブラウザ内で完結する動画ライブラリ。
- File System Access API 対応ブラウザでのフォルダ選択、ハンドル永続化、再スキャン、ローカルファイル管理。
- File System Access API 非対応ブラウザでの folder input による読み取り専用ブラウズ。
- 再帰的なサブフォルダスキャン。
- グリッド、リスト表示。
- ファイル名、フォルダ、サイズ、更新日、再生時間、サムネイルの表示。
- 検索、フォルダフィルタ、ソート。
- object URL による動画再生。
- フルスクリーン風プレイヤー、ネイティブメディアコントロール、キーボード操作。
- 1 本リピート、親フォルダ内の順次再生。
- ファイル名変更、単体/複数移動、ネストしたフォルダ作成、フォルダ名変更、フォルダ削除、単体/複数削除。
- PWA インストール、オフライン時のアプリシェル起動。

### 2.2 非対象範囲

- 動画のダウンロードキュー。
- X アカウント連携、SNS 連携。
- 認証、ユーザーアカウント。
- Turso、SQLite、クラウドデータベース、API ルート。
- AI タグ付け、文字起こし、推薦。
- 動画変換、トランスコード、サムネイルの永続保存。
- ブラウザが再生できないコーデックの再生保証。
- Safari/Firefox の読み書き対応。非対応環境では読み取り専用とする。

## 3. 対象ユーザーと利用シーン

### 3.1 対象ユーザー

- 古いミュージックビデオ、ライブ映像、録画データをローカルディスクに多数保存しているユーザー。
- フォルダ名で年代、アーティスト、ジャンル、入手元を分類しているユーザー。
- ファイル名を一括整理したいが、クラウドに動画をアップロードしたくないユーザー。
- オフライン環境でもライブラリ UI を開きたいユーザー。

### 3.2 高容量アーカイブの主要ユースケース

- 数千件の動画を含む親フォルダを選択し、UI を固まらせずに再帰スキャンする。
- `Artist/Year/Title.mp4` のようなサブフォルダ構造をフォルダフィルタとして使う。
- ファイル名の表記ゆれを素早く見つけ、リネームする。
- 検索語で対象を絞り、更新日やサイズで並べ替える。
- 同じ親フォルダ内のミュージックビデオを順番に再生する。
- 選択した複数ファイルを新しいネストフォルダへ移動する。
- 不要な重複動画を選択し、明示確認の上で削除する。

## 4. 機能要件と受け入れ基準

### 4.1 フォルダ選択と再リンク

要件:

- File System Access API 対応ブラウザでは `showDirectoryPicker` でローカルフォルダを選択する。
- 選択した `FileSystemDirectoryHandle` を IndexedDB に保存する。
- アプリ再起動後、保存済みハンドルを読み込み、権限が残っていれば自動スキャンする。
- 権限が失われている場合は、保存フォルダ名を表示し、ユーザー操作で再許可を求める。
- 非対応ブラウザでは `input[type=file][webkitdirectory]` による読み取り専用フォールバックを提供する。

受け入れ基準:

- Chrome/Edge で選択したフォルダをリロード後に再認識できる。
- 権限が `prompt` または `denied` になった場合、スキャンや書き込み操作が失敗理由を表示する。
- Safari/Firefox ではローカルファイルを選択して閲覧できるが、管理ボタンは無効化される。

### 4.2 再帰スキャン

要件:

- `.mp4`, `.m4v`, `.mov`, `.webm`, `.ogv`, `.ogg` を対象にする。
- サブフォルダを再帰的に走査する。
- 空フォルダもフォルダ一覧に残す。
- 大規模フォルダでメインスレッドを長時間ブロックしない。
- 読み取り不能なファイルやフォルダは個別エラーとして集計し、スキャン全体を止めない。

受け入れ基準:

- ネストしたフォルダ配下の動画が一覧に出る。
- 非動画ファイルはスキップ数として扱われる。
- スキャン中に検出済みファイル数、フォルダ数が更新される。
- 外部変更後にリフレッシュすると一覧が再計算される。

### 4.3 ブラウズ UI

要件:

- メイン画面はマーケティングページではなく、すぐにライブラリ操作ができる画面とする。
- 左側または上部にフォルダ分類を表示する。
- グリッドとリストを切り替えられる。
- 高密度だが読めるカード/行デザインにする。
- 表示件数は段階的に増やし、数千件を一度に DOM マウントしない。

受け入れ基準:

- デスクトップでサイドバー、検索、ソート、動画一覧が重ならない。
- モバイルでフォルダ一覧とツールバーが横スクロールまたは折り返し、操作要素が重ならない。
- 初期表示は最大件数を制限し、「さらに表示」で追加表示できる。

### 4.4 サムネイルとメタデータ

要件:

- ファイル名、親フォルダ、サイズ、更新日をスキャン結果から表示する。
- 再生時間とサムネイルは遅延生成する。
- サムネイル生成は visible な動画を中心に限定し、同時実行数を抑える。
- object URL は生成後に必ず revoke する。
- 破損ファイルや非対応コーデックではプレビュー失敗として扱い、一覧から落とさない。

受け入れ基準:

- 一覧表示直後に基本メタデータが表示される。
- サムネイルと再生時間は順次更新される。
- サムネイル生成失敗時もカードが安定したサイズを維持する。

### 4.5 検索、ソート、フィルタ

要件:

- ファイル名とフォルダパスに対する高速検索を行う。
- フォルダフィルタは現在の親フォルダ単位で絞り込む。
- ソートは名前、フォルダ、更新日、サイズ、再生時間を提供する。
- ソート方向を切り替えられる。

受け入れ基準:

- 検索語入力時に UI が固まらない。
- 名前ソートは自然順に近い並びになる。
- 再生時間が未取得の動画は取得後に並び替え対象になる。

### 4.6 再生

要件:

- 動画再生は `URL.createObjectURL(file)` を使う。
- プレイヤー終了時、動画切り替え時に object URL を revoke する。
- ネイティブ `video` controls を使う。
- プレイヤーは全画面風の黒背景オーバーレイで表示する。
- ダブルクリック/ボタンでフルスクリーンを切り替える。
- iOS/Safari 系の WebKit fullscreen 差異に備える。

受け入れ基準:

- 動画を開くと自動再生を試み、失敗してもネイティブ controls で再生できる。
- 閉じる、前へ、次へ、フルスクリーン、リピート切り替えが動作する。
- 非対応コーデックや移動済みファイルの場合、プレイヤー内にエラーを表示する。

### 4.7 キーボード操作

要件:

- `Escape`: フルスクリーン中でなければプレイヤーを閉じる。
- `ArrowLeft`: 現在のプレイリストで前へ。
- `ArrowRight`: 現在のプレイリストで次へ。
- `Space`: 再生/一時停止。
- 入力欄、select、textarea、contenteditable 中はショートカットを奪わない。

受け入れ基準:

- プレイヤー上で左右キーが動画間移動になる。
- 検索入力中に Space や左右キーが入力操作を妨げない。

### 4.8 リピートとフォルダ順次再生

要件:

- リピートモードは `off`, `one`, `folder`。
- `one` では現在動画を loop 再生する。
- `folder` では現在動画の実際の親フォルダに属する動画だけを順次再生する。
- 前へ/次へも同じ親フォルダのプレイリストを使う。

受け入れ基準:

- 検索や表示フィルタと関係なく、プレイリストは現在動画の `folderPath` で決まる。
- フォルダ末尾から次へ進むと先頭に戻る。

### 4.9 ファイル名変更

要件:

- 動画カード/行からリネームを直接開ける。
- 新しい名前は空文字、パス区切り、`.`/`..` を禁止する。
- 対象拡張子はブラウザ再生対象拡張子に限定する。
- 同一フォルダ内に同名ファイルがある場合は失敗させる。
- File System Access API にネイティブ rename がない環境では、コピー成功後に元ファイルを削除する。

受け入れ基準:

- 名前変更後に一覧が再スキャンされる。
- 競合時に既存ファイルを上書きしない。
- 元ファイル削除に失敗した場合はエラーとして表示し、ユーザーが再スキャンできる。

### 4.10 移動

要件:

- 単体動画と複数選択動画を移動できる。
- 移動先は既存フォルダまたは新規ネストパスを指定できる。
- 移動先フォルダが存在しない場合は作成する。
- 同名ファイルが移動先にある場合は上書きせず、操作を失敗させる。
- コピー成功後に元ファイルを削除する。

受け入れ基準:

- 選択した複数動画を `music-videos/1997` のような新規サブフォルダへ移動できる。
- 移動後、フォルダ一覧と動画一覧が更新される。
- 移動途中の失敗はエラー表示され、ユーザーは再スキャンで状態を確認できる。

### 4.11 フォルダ管理

要件:

- ネストしたフォルダを作成できる。
- 選択中フォルダをリネームできる。
- フォルダ削除は確認ダイアログを必須とし、配下の内容も削除されることを明示する。
- ルートフォルダはリネーム/削除できない。
- フォルダ名はパス区切りを含まない単一名でリネームする。

受け入れ基準:

- 空フォルダ作成後もフォルダ一覧に表示される。
- フォルダリネーム後にパスが更新される。
- 削除確認なしにフォルダは削除されない。

### 4.12 削除

要件:

- 単体動画削除と複数選択削除を提供する。
- 削除は元のローカルファイルを永久に削除することを明示する。
- 確認なしに削除しない。
- 読み取り専用フォールバックでは削除機能を無効化する。

受け入れ基準:

- 削除操作前に確認ダイアログが出る。
- 削除後に一覧が再スキャンされる。
- 外部変更で対象が存在しない場合はエラーを表示する。

### 4.13 外部変更とリフレッシュ

要件:

- ユーザーが Finder/Explorer 等でファイルを変更した場合、アプリは Refresh で再スキャンする。
- 操作失敗時は再スキャンできる状態を維持する。
- 可能な限り部分失敗を隠さない。

受け入れ基準:

- 外部で削除したファイルを再生しようとするとエラーになる。
- Refresh 後には削除済みファイルが一覧から消える。

### 4.14 PWA とオフライン

要件:

- Web App Manifest を提供する。
- 192px、512px、maskable 512px のアイコンを提供する。
- `beforeinstallprompt` 対応環境では Install ボタンを表示する。
- Service Worker は app shell と静的アセットのみキャッシュする。
- local video data, blob URL, file URL, audio/video request はキャッシュしない。

受け入れ基準:

- HTTPS または localhost でインストール可能な manifest が読み込まれる。
- オフラインでもアプリ UI は開く。
- ローカル動画ファイルが Cache Storage に保存されない。

## 5. 情報設計

### 5.1 主要画面

1. ライブラリ画面
   - 左サイドバー: ソースフォルダ、開く/変更、更新、フォルダ一覧、フォルダ管理。
   - メイン: 検索、インストール、表示切り替え、ソート、選択バー、動画一覧。
2. プレイヤー画面
   - 黒背景の固定オーバーレイ。
   - 上部: タイトル、フォルダ、位置、フルスクリーン、閉じる。
   - 中央: native video。
   - 下部: 前へ、次へ、リピート。
3. ダイアログ
   - 削除確認。
   - フォルダ削除確認。
   - リネーム。
   - フォルダ作成。
   - 移動先選択。

### 5.2 状態フロー

- 初回起動:
  1. IndexedDB から保存済みハンドルを探す。
  2. ハンドルがなければ「Open folder」を表示。
  3. ハンドルがあり読み取り許可済みならスキャン。
  4. 許可が必要なら保存フォルダ名を表示し、ユーザー操作で再許可。

- スキャン:
  1. アダプタがフォルダを再帰走査。
  2. 進捗を UI に反映。
  3. 動画一覧、フォルダ一覧、スキップ数、エラー数を更新。
  4. 表示中の動画からサムネイル/再生時間を遅延取得。

- 再生:
  1. 対象動画の File を取得。
  2. object URL を生成。
  3. video にセット。
  4. 終了/切替/アンマウント時に revoke。

- 書き込み操作:
  1. writable adapter か確認。
  2. readwrite permission を確認/要求。
  3. バリデーション。
  4. 競合チェック。
  5. 操作実行。
  6. 再スキャン。
  7. 失敗時はエラー表示。

## 6. ストレージ設計

### 6.1 アダプタ構成

`VideoStorageAdapter` を境界にして、読み書き可能な File System Access 実装と、読み取り専用 folder input 実装を分離する。

```ts
interface VideoStorageAdapter {
  readonly mode: "directory" | "folder-input";
  readonly writable: boolean;
  readonly rootName: string;
  scan(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult>;
  createObjectUrl(entry: VideoFileEntry): Promise<string>;
  canWrite(): Promise<boolean>;
  deleteVideos(entries: VideoFileEntry[]): Promise<void>;
  renameVideo(entry: VideoFileEntry, nextName: string): Promise<void>;
  moveVideos(entries: VideoFileEntry[], targetFolderPath: string): Promise<void>;
  createFolder(folderPath: string): Promise<void>;
  renameFolder(folderPath: string, nextName: string): Promise<void>;
  deleteFolder(folderPath: string): Promise<void>;
}
```

### 6.2 DirectoryVideoAdapter

- `FileSystemDirectoryHandle` を保持する。
- `showDirectoryPicker({ mode: "readwrite" })` で選択する。
- `queryPermission`/`requestPermission` を通じて read/readwrite 権限を確認する。
- `entries()` で再帰走査する。
- `getFile()` でサイズ、更新日、object URL 作成用 File を取得する。
- `createWritable()` と `removeEntry()` で rename/move/delete を実装する。

### 6.3 FolderInputVideoAdapter

- `File[]` を保持する。
- `webkitRelativePath` から相対パスを復元する。
- object URL 作成とスキャンのみを提供する。
- すべての書き込み操作は読み取り専用エラーにする。

読み取り専用にする理由:

- folder input で得られる `File` は元ファイルへの書き込みハンドルではない。
- ブラウザに安全な rename/delete API がない。
- 見かけ上の削除を実装すると、元ファイルが変わったとユーザーが誤解する。

### 6.4 IndexedDB

DB:

- name: `local-video-pwa`
- version: `1`
- object store: `kv`

キー:

- `video-root-handle`: `FileSystemDirectoryHandle`

保存しないもの:

- 動画ファイル本体。
- サムネイル画像。
- 再生時間。
- object URL。

メタデータとサムネイルを永続保存しない理由:

- 大量動画で IndexedDB 使用量が膨らむ。
- ファイル外部変更時の整合性管理が複雑になる。
- 初期実装では遅延生成で十分な UX が得られる。

## 7. データ型

```ts
type SourceMode = "directory" | "folder-input";
type SortKey = "name" | "folder" | "modified" | "size" | "duration";
type SortDirection = "asc" | "desc";
type ViewMode = "grid" | "list";
type RepeatMode = "off" | "one" | "folder";
```

```ts
interface VideoFileEntry {
  id: string;
  name: string;
  path: string;
  folderPath: string;
  size: number;
  lastModified?: number;
  sourceMode: SourceMode;
  file?: File;
  handle?: FileSystemFileHandle;
}
```

```ts
interface FolderEntry {
  path: string;
  name: string;
  count: number;
  totalSize: number;
}
```

```ts
interface VideoMeta {
  duration?: number;
  thumbUrl?: string;
  failed?: boolean;
}
```

```ts
interface ScanResult {
  videos: VideoFileEntry[];
  folders: string[];
  skipped: number;
  errors: string[];
}
```

## 8. ファイル操作の安全ルール

### 8.1 共通

- 書き込み操作は `adapter.writable === true` の場合だけ UI 有効化する。
- 実行直前に readwrite permission を確認する。
- 失敗時は成功扱いしない。
- 操作後は再スキャンする。
- 競合時は上書きしない。
- パス区切りを含むファイル名を禁止する。
- フォルダ作成/移動先は正規化した相対パスだけ許可する。
- `.` と `..` を禁止する。
- 削除とフォルダ削除は必ず確認ダイアログを出す。

### 8.2 Rename

- 新ファイル名を検証する。
- 同一フォルダ内の同名ファイルを検出したら中止する。
- コピーに成功してから元ファイルを削除する。
- 元ファイル削除に失敗したらエラー表示し、再スキャンを促す。

### 8.3 Move

- 移動先フォルダがなければ作成する。
- 移動先に同名ファイルがあれば中止する。
- 複数移動では各ファイルを順次処理する。
- 途中失敗時はエラー表示し、既に移動済みの実ファイル状態を再スキャンで反映する。

### 8.4 Delete

- 動画削除は `removeEntry(fileName)` を使う。
- フォルダ削除は `removeEntry(name, { recursive: true })` を使う。
- ダイアログ本文に「元のローカルフォルダへ永久に影響する」ことを明示する。

## 9. パフォーマンス設計

### 9.1 スキャン

- 走査は非同期再帰で行う。
- 一定件数ごとに `requestAnimationFrame` または `setTimeout(0)` でブラウザに制御を返す。
- 進捗は `ScanProgress` として UI に反映する。
- 個別ファイル/フォルダの読み取り失敗は集計し、スキャン全体を止めない。

### 9.2 表示

- 検索語は `useDeferredValue` で UI 入力を優先する。
- 表示件数は初期 `PAGE_SIZE = 180` に制限し、「さらに表示」で追加する。
- 完全な仮想スクロールは初期実装では採用しない。理由は依存を増やさず、固定高さではないグリッド/リストを安定させやすいため。
- 将来、1 万件超で DOM サイズが問題になれば仮想化を導入する。

### 9.3 サムネイル/メタデータ

- visible な動画を中心に最大 80 件ずつ処理する。
- 現実装は逐次処理でメインスレッド負荷と同時 object URL 数を抑える。
- `loadedmetadata` 後に短い位置へ seek し、canvas で JPEG data URL を作る。
- object URL は処理終了後に revoke する。
- 生成失敗を `failed` として記録し、再試行ループを避ける。

### 9.4 Object URL ライフタイム

- 一覧サムネイル: メタデータ取得処理ごとに生成し、finally で revoke。
- プレイヤー: 再生対象ごとに生成し、対象変更またはアンマウントで revoke。
- object URL は永続化しない。

## 10. PWA と Service Worker

### 10.1 Manifest

- `display: "standalone"`
- `start_url: "/"`
- `scope: "/"`
- `theme_color: "#111111"`
- PNG icons: 192, 512, maskable 512

### 10.2 キャッシュ方針

キャッシュする:

- `/`
- `/index.html`
- `/manifest.webmanifest`
- アイコン
- 同一 origin の script/style/font/image 等の静的アセット

キャッシュしない:

- `request.destination === "video"`
- `request.destination === "audio"`
- `blob:` URL
- `file:` URL
- 他 origin の request
- ユーザーのローカル動画ファイル本体

### 10.3 オフライン時

- navigation request は network first とし、失敗時に cached `/index.html` を返す。
- 動画ファイルへのアクセスはブラウザのローカルファイル権限に依存する。
- オフラインでもアプリ UI は開くが、未許可フォルダに対する再リンクはブラウザ権限 UI に依存する。

## 11. プライバシーとセキュリティ

重要判断:

- ローカル動画は端末外へ送らない。
- アプリにはサーバー API がない。
- 動画ファイル本体を Cache Storage に入れない。
- IndexedDB に保存するのはディレクトリハンドルのみ。
- 書き込み操作はユーザー操作とブラウザ権限に依存する。
- 破壊的操作は確認を必須にする。

理由:

- 動画アーカイブには個人情報、購入物、未公開素材が含まれる可能性がある。
- クラウド同期やアップロードはユーザーの意図を超えるリスクがある。
- Service Worker が動画をキャッシュすると、削除後にもブラウザ内にコピーが残る恐れがある。

## 12. エラー、空、読み込み状態

### 12.1 空状態

- 初回: `Open folder`
- スキャン結果 0 件: `No videos found` と Rescan

### 12.2 読み込み状態

- スキャン中: 検出済み動画数、フォルダ数を表示。
- サムネイル未取得: 安定したプレースホルダを表示。

### 12.3 エラー状態

- 読み取り権限なし: フォルダを再度開く/許可するよう促す。
- 書き込み権限なし: 管理操作を失敗させ、理由を表示。
- ファイル競合: 上書きせずエラー。
- ファイル外部削除: 再生/操作時にエラー、Refresh で解決。
- 破損/非対応動画: プレイヤーまたはカード上でプレビュー不可として扱う。

## 13. コンポーネント/モジュール設計

### 13.1 UI

- `src/App.tsx`
  - アプリ全体の状態管理。
  - フォルダ選択、スキャン、検索、ソート、選択、ダイアログ制御。
  - ファイル操作後の再スキャン。
- `src/components/VideoPlayer.tsx`
  - object URL 再生。
  - キーボード制御。
  - フルスクリーン。
  - リピート/前後移動 UI。
- `src/styles.css`
  - 全体レイアウト。
  - 高密度グリッド/リスト。
  - プレイヤー CSS。
  - レスポンシブ対応。

### 13.2 ライブラリ

- `src/lib/video-storage.ts`
  - `DirectoryVideoAdapter`
  - `FolderInputVideoAdapter`
  - スキャン、権限、ファイル操作。
- `src/lib/idb.ts`
  - IndexedDB の kv store。
- `src/lib/file-helpers.ts`
  - パス正規化、拡張子判定、表示フォーマット、検索、ソート。
- `src/lib/video-thumb.ts`
  - サムネイル/再生時間の遅延取得。
- `src/lib/video-playlist.ts`
  - repeat mode、フォルダプレイリスト、前後移動。
- `src/lib/video-fullscreen.ts`
  - standard/webkit fullscreen helper。
- `src/lib/video-player-keys.ts`
  - キーボードアクションと入力対象判定。
- `src/registerServiceWorker.ts`
  - Service Worker 登録。

## 14. x-idea からの再利用マップ

参照元は `/Users/takutakashina/work/projects/x-idea`。同リポジトリは読み取り専用で扱い、変更しない。

| x-idea ファイル | 方針 | 理由 |
| --- | --- | --- |
| `src/components/videos/VideoPlayer.tsx` | 適応実装 | プレイヤーの構造、object URL 再生、chrome hide、Escape/左右/Space の挙動、フルスクリーン方針が有用。Next.js/Tailwind/API fallback 依存は除去し、Vite/React と lucide icons に合わせた。 |
| `src/components/videos/VideosWorkspace.tsx` | 一部概念のみ再実装 | 旧実装は X、ダウンロードキュー、API、React Query、アカウントに強く依存。今回必要なのはフォルダ、一覧、移動/削除の操作概念のみ。 |
| `src/lib/video-store.ts` | ハンドル永続化と File System Access の考え方を適応 | IndexedDB への `FileSystemDirectoryHandle` 保存、permission check、`createWritable`/`removeEntry` の安全な扱いが有用。ダウンロード、レジューム、部分ファイル、アカウントパスは除外。 |
| `src/lib/video-playlist.ts` | ほぼ移植 | `RepeatMode`, `folderPlaylist`, `stepPlaylist` は今回の要件に合う。`folderId` ではなく `folderPath` ベースに変更。 |
| `src/lib/video-fullscreen.ts` | ほぼ移植 | standard fullscreen と WebKit fallback は独立性が高く、そのまま近い形で再利用。 |
| `src/lib/video-player-keys.ts` | ほぼ移植 | 入力中にショートカットを奪わない判定が有用。文言と型だけ standalone に合わせた。 |
| `src/app/globals.css` の video-player CSS | 適応実装 | focus outline 抑制、WebKit media controls fade、chrome hidden 時の controls hide を採用。Tailwind 前提のクラスは通常 CSS に変換。 |
| `media-video-api`, download plan, queue, auth, library cache | 不採用 | ローカル保存済み動画ブラウザには不要。クラウド/API/ダウンロード責務を持ち込まないため。 |

## 15. 重要なアーキテクチャ決定

### ADR-001: ローカル動画は端末内に残す

決定:

- 動画ファイルはアップロードしない。
- 再生は object URL で行う。

理由:

- 大容量動画の転送コストを避ける。
- 個人アーカイブのプライバシーを守る。
- PWA として静的配信だけで動く。

### ADR-002: 非対応ブラウザの fallback は読み取り専用

決定:

- folder input fallback では rename/move/delete/create folder を提供しない。

理由:

- `File` オブジェクトだけでは元ファイルへ安全に書き戻せない。
- UI 上だけで削除したように見せるのは誤解を招く。
- ブラウザのセキュリティモデルに従う。

### ADR-003: 破壊的操作は明示確認必須

決定:

- 動画削除とフォルダ削除は確認ダイアログ必須。
- フォルダ削除は配下の内容も削除されることを表示する。

理由:

- 操作対象はアプリ内データではなく元のローカルファイル。
- Undo を保証できない。
- 大量選択時の誤操作被害が大きい。

### ADR-004: メタデータとサムネイルは遅延生成し、永続保存しない

決定:

- 初期スキャンではファイル基本情報だけ取得する。
- サムネイルと duration は表示中アイテムから順次生成する。

理由:

- 数千件の初回スキャンを軽くする。
- IndexedDB の肥大化を避ける。
- 外部変更による stale cache 問題を避ける。

### ADR-005: 初期実装はページング型の段階表示を採用する

決定:

- 仮想スクロールライブラリは導入せず、表示件数を段階的に増やす。

理由:

- グリッドとリストの可変高さを単純に扱える。
- 依存を抑えられる。
- 現在の要件では十分な体感性能が期待できる。

## 16. テスト戦略

### 16.1 自動テスト

- `file-helpers`
  - 拡張子/名前検証。
  - フォルダパス検証。
  - 検索、ソート。
  - 表示フォーマット。
- `video-playlist`
  - フォルダ単位のプレイリスト。
  - 前後移動の wrap。
  - repeat mode parse/toggle。

### 16.2 手動/ブラウザ検証

- Chrome/Edge:
  - フォルダ選択。
  - リロード後の保存ハンドル復帰。
  - スキャン、検索、ソート、フォルダフィルタ。
  - 再生、閉じる、前へ/次へ、Space、Escape、フルスクリーン。
  - rename/move/delete/create folder。
  - 権限拒否時のエラー表示。
- Safari/Firefox:
  - folder input fallback。
  - 読み取り専用 UI。
  - 管理機能が使えると誤認させないこと。
- PWA:
  - manifest 読み込み。
  - install prompt。
  - offline app shell。
  - Cache Storage に動画が入らないこと。

### 16.3 実ファイル操作テストの制約

- ユーザーの実アーカイブで破壊的テストをしない。
- テスト用の一時フォルダと小さいダミー動画だけを使う。
- 削除確認の文言とボタン状態を確認する。

## 17. ビルド/デプロイ制約

- React + TypeScript + Vite。
- 静的ホスティング可能。
- PWA install/service worker には HTTPS または localhost が必要。
- File System Access API は主に Chromium 系ブラウザの secure context が必要。
- iOS Safari では File System Access API がなく、PWA のファイルアクセス制約も強い。
- `.mov` はファイル拡張子として検出するが、再生可否はコーデックとブラウザに依存する。

## 18. 未解決事項

- 大量サムネイルの永続キャッシュを将来導入するか。
- 1 万件以上で完全仮想化が必要になる閾値。
- ファイル操作の進捗表示をバイト単位で出すか。
- フォルダ削除時に配下件数を事前カウントするか。
- 重複検出、ファイル名一括置換、正規表現リネームを追加するか。
- OPFS を使った非動画メタデータキャッシュを導入するか。

## 19. 段階的実装計画

### Phase 1: Standalone PWA 基盤

- Vite + React + TypeScript。
- Manifest、icons、service worker。
- README。
- Git 初期化。

### Phase 2: ローカルフォルダ読み取り

- File System Access adapter。
- IndexedDB handle persistence。
- folder input fallback。
- 再帰スキャン。
- スキャン進捗。

### Phase 3: ライブラリ UI

- サイドバー folder IA。
- グリッド/リスト。
- 検索、ソート、フォルダフィルタ。
- 段階表示。
- サムネイル/duration 遅延生成。

### Phase 4: プレイヤー

- object URL playback。
- キーボード操作。
- fullscreen helper。
- repeat one / folder sequence。
- object URL cleanup。

### Phase 5: ファイル管理

- rename。
- create nested folder。
- move single/bulk。
- delete single/bulk。
- rename/delete folder。
- permission/conflict/error handling。

### Phase 6: 検証と調整

- unit tests。
- typecheck/build。
- desktop/mobile browser layout。
- PWA cache policy review。
- 実ファイル操作はテスト用フォルダだけで実施。
