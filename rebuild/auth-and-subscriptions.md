# Authentication, Session, Verification, Subscription Model

## Login model

### Manual login
- Endpoint: `POST slogin.php`
- Core request fields:
  - `user`, `pass`
  - `dtype=androidtv`
  - `serialno=<device uuid>`
  - `cookiekey=<device uuid>` (mapped to `x-fingerprint` header)

### Auto login
- Endpoint: `POST slogin.php`
- Core request fields:
  - `dtype=androidtv`
  - `serialno=<device uuid>`
- Triggered when a “unique device” condition is met.

### Error code handling during login
Observed server error branches:
- `11302` (login error message)
- `11301` (interactive-user related restriction)
- `11009` (account not found)
- `429` (blocked login popup)
- `58403` (VPN blocked popup)

## Account activation/verification
- If login returns inactive account (`isactive == 0`), app opens code verification flow.
- Verification endpoints:
  - `active.php`
  - `reactivemail.php`

## Session persistence
State is persisted in `SharedPreferences("logindetails")` with keys including:
- Identity: `id`, `name`, `email`, `phone`, `password`
- Session/auth: `sid`, `status`, `isactive`, `activekey`
- Timing: `regtime`, `ptime`, `expires`
- UX config: `carousel`

## Subscription / package model
Package/subscription info is nested under response `package` and stored as:
- `package_id`
- `package_name`
- `package_price`
- `package_pricestr`
- `package_pgname`
- `package_description`

`expires` and account `status`/`isactive` are used to determine active/inactive subscription states in profile and popups.

## Guest mode
There is a bypass flow that writes a synthetic guest session locally:
- `id=guest`, `sid=guest-session`, status/package fields set to guest defaults.
- Useful for your TS rebuild if you want a non-auth browsing mode.
