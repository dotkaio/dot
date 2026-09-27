# TypeScript Rebuild Blueprint

## Recommended architecture

## 1) API client layer
Create a typed HTTP layer (Axios/fetch) with:
- `baseURL = https://api.israel.tv/`
- Request interceptor:
  - attach `User-Agent` equivalent metadata where possible
  - attach `x-fingerprint` from device identity if present
- Response normalizer:
  - handle `object | array | raw text` payloads

Suggested files:
- `src/api/httpClient.ts`
- `src/api/endpoints.ts`
- `src/api/types.ts`

## 2) Service modules by domain
- `src/services/authService.ts`
- `src/services/profileService.ts`
- `src/services/channelsService.ts`
- `src/services/guideService.ts`
- `src/services/vodService.ts`
- `src/services/searchService.ts`
- `src/services/favoritesService.ts`

Each service should expose strongly typed methods mirroring current endpoint uses.

## 3) Auth/session store
Use a persistent store abstraction:
- Web: localStorage + in-memory cache
- React Native/Electron: secure storage equivalent

Persist keys equivalent to Android `logindetails` schema, especially:
- `sid`, `id`, `email`, `status`, `isactive`
- package fields + `expires`

## 4) Request compatibility strategy
To preserve behavior during migration:
- Keep endpoint paths exactly as-is (`*.php`).
- Keep GET/POST methods exactly as current app initially.
- Keep query param names unchanged.
- Introduce compatibility wrappers first, then refactor.

## 5) Suggested TypeScript contracts
- `AuthResponse`, `UserProfileResponse`, `PackageInfo`
- `Channel`, `GuideProgram`, `RecordItem`
- `VodCategory`, `VodItem`, `Episode`, `TvShow`
- `FavoriteActionResponse`, `SearchResults`

## 6) Error model
Create a centralized parser that checks:
- `error` numeric/string codes from API payloads
- transport errors (timeout/network)
- authorization/session errors (missing/expired `sid`)

Map known codes (`11302`, `11301`, `11009`, `429`, `58403`) to typed domain errors.

## 7) Milestone order
1. Build auth + session persistence (`slogin.php`, `loaduser.php`).
2. Build channels/guide playback metadata (`channels.php`, `schbydate.php`, `chls.php`).
3. Build VOD taxonomy + playback (`vodcatemain.php`, `vodcatesubs.php`, `vodcatelist.php`, `loadvod2.php`).
4. Add favorites/search (`myfav.php`, `search.php`).
5. Add verification/recovery and package UX.
