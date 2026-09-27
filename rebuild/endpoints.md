# Endpoint Inventory

Base URL: `https://api.israel.tv/`

## Authentication & Account
- `slogin.php` (POST)
  - Manual login (`user`, `pass`, `dtype`, `serialno`, `cookiekey`)
  - Auto-login (`dtype`, `serialno`)
- `register.php` (GET)
  - Registration flow
- `active.php` (GET)
  - Verify account with code
- `reactivemail.php` (GET)
  - Resend activation/verification mail
- `forgetpassword.php` (GET)
  - Forgot/reset password trigger
- `loaduser.php` (GET)
  - Profile/user details refresh

## Live / Radio / Guide / Recorded TV
- `channels.php` (GET)
  - Fetch channels, radio lists, searchable channel sets
- `chls.php` (GET)
  - Resolve/prepare stream playback for live channels
- `schbydate.php` (GET)
  - TV guide schedule / record schedule by date
- `weekday.php` (GET)
  - Week-day schedule index for records
- `loadrecord.php` (GET)
  - Load recorded program playback URLs/details

## VOD
- `vodcatemain.php` (GET)
  - Main VOD categories
- `vodcatesubs.php` (GET)
  - Subcategory levels (sub/sub-sub variants)
- `vodcatelist.php` (GET)
  - Category item lists + paginated page fetches + tv show/movie lists
- `vodnew.php` (GET)
  - Newly added VOD episodes/movies
- `loadvod2.php` (GET)
  - Resolve stream details for VOD playback (movie/tv show)

## Search / Favorites / Notices
- `search.php` (GET/POST)
  - Search across VOD and other assets (both methods used)
- `myfav.php` (GET)
  - Add/remove/list favorites for live/VOD/radio content
- `notice.php` (GET)
  - System notification/banner message

## Web pages used in app (non-API endpoints)
- `https://mobile.israel.tv/he/packages?sid=...` (package web view)
- `http://israel.tv/he/speedtest_tv?sid=...` (speedtest web view)
