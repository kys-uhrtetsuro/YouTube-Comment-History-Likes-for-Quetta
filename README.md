# YouTube Comment History + Likes for Quetta

Android Quetta compatibility port of [SecuredByKC/YouTube-Comment-History-Plus-Likes](https://github.com/SecuredByKC/YouTube-Comment-History-Plus-Likes). The upstream README declares the MIT license.

## Install on Android

1. Download `YouTube-Comment-History-for-Quetta.zip` from this repository (ZIP manifest is at archive root).
2. In Quetta → Extensions → Developer Mode → install from `.zip/.crx/.user.js`, choose the ZIP.
3. Use **Scan Comments** to scan your own YouTube comment history on Google My Activity.
4. [Enable YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) in a Google Cloud project, then [create an API key](https://console.cloud.google.com/apis/credentials). Restrict the key to YouTube Data API v3 and set reasonable quotas.
5. Paste the key into the extension, tap **Save / Test**, then **Fetch Likes**.
6. Sort the result by **Most Likes**.

## Error handling (v1.2.1)
- HTTP 403/404 for inaccessible comments or videos skips the affected item and continues.
- API authentication, invalid-key, API-not-enabled and quota/rate-limit errors remain fatal, with an on-screen error.
- Unretrieved likes display as **—**; genuine 0 likes display as **0**.

## Changes and limitations

- Does not call unsupported `chrome.identity.getAuthToken`. Queries only public YouTube Data API endpoints using your own key.
- Direct comment-ID lookup is preferred, including replies. For missing/deleted IDs, public video threads are searched by **exact text**, at most 1,000 newest threads per video.
- Replies nested deeper than the partial replies returned with a thread may be missed. Deleted/private/unavailable comments cannot reliably be counted. An unfetched comment is not necessarily zero likes.
- API key and comments are stored in `chrome.storage.local` on your device, not committed to this repository or sent to a project server. The key is used only in requests to Google APIs.
- You may need to rescan your comments, because this is a different browser extension with its own storage.
- **Initial build is not yet tested on Android Quetta.** Please share extension error logs if something fails.

## Credits

Original: [SecuredByKC](https://github.com/SecuredByKC/YouTube-Comment-History-Plus-Likes). Upstream README declares MIT license. See NOTICE.md.
