# Fundamental API Fetch Architecture (Current App)

## 1) Network stack
- Core request wrapper: `NetworkOperation/JSONRequestResponse.java`.
- Request engine: Android Volley via singleton queue in `NetworkOperation/MyVolley.java`.
- Pattern used everywhere:
  1. Build a `Bundle` of params.
  2. Call `MyVolley.init(context)`.
  3. Call `mResponse.getResponse(method, url, requestCode, listener, params, ...)`.
  4. Parse response via callbacks:
     - `SuccessResponse(JSONObject...)`
     - `SuccessResponseArray(JSONArray...)`
     - `SuccessResponseRaw(String...)`
     - `ErrorResponse(VolleyError...)`

## 2) URL construction and request semantics
- Base API host: `https://api.israel.tv/`.
- Image/media base host: `http://israel.tv/`.
- GET requests append params to URL query string manually.
- POST requests submit params via Volley `getParams()`.
- Request cache is aggressively disabled/cleared:
  - `setShouldCache(false)` and queue cache clear before enqueue.
- Retry policy:
  - Default requests: timeout 15s, retries 0.
  - Multipart upload path has longer timeout + 1 retry.

## 3) Headers and device fingerprint
- App appends version/build details to `User-agent` header.
- If param `cookiekey` exists, it is moved to header `x-fingerprint` and removed from params.
- Device identity is used frequently (`Constant.getDeviceUUID(...)`) as `serialno` and fingerprint.

## 4) Session/auth state storage
- Primary persisted state: shared preferences `logindetails`.
- Includes identity and authorization-like session fields such as:
  - `sid` (server session id used in many API calls)
  - account fields (`id`, `name`, `email`, `status`, `isactive`)
  - package/subscription fields (`package_id`, `package_name`, `package_price`, `expires`, etc.)

## 5) Cross-feature API domain boundaries
- Auth/account: `slogin.php`, `register.php`, `active.php`, `reactivemail.php`, `forgetpassword.php`, `loaduser.php`
- Live channels/radio/guide: `channels.php`, `chls.php`, `schbydate.php`, `weekday.php`
- VOD taxonomy/content: `vodcatemain.php`, `vodcatesubs.php`, `vodcatelist.php`, `vodnew.php`, `loadvod2.php`
- Search: `search.php`
- Favorites: `myfav.php`
- System messages: `notice.php`

## 6) Notable behavior to preserve in TS rewrite
- Request codes are used to multiplex multiple API responses through one listener.
- Same endpoint is reused for many modes (distinguished by query params like `action`, ids, pagination).
- Some flows call GET where POST could be expected; keep compatibility first, then normalize later.
- Guest-mode bypass exists in login flow and seeds fake local session values.
