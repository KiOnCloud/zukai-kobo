<!-- zukai doc, lang=en: generated from the IR, regenerate instead of editing -->
# Login with password

Diagram kind: Sequence diagram

## Participants

| No. | Participant | Kind |
| --- | --- | --- |
| 1 | User | Actor |
| 2 | Web app | Participant |
| 3 | Auth service | Control |
| 4 | User DB | Database |

## Steps

| No. | From | To | Message | Kind | Condition |
| --- | --- | --- | --- | --- | --- |
| 1 | User | Web app | Submit credentials | Synchronous | loop: until 3 attempts |
| 2 | Web app | Auth service | POST /login | Synchronous | loop: until 3 attempts |
| 3 | Auth service | User DB | SELECT user by email | Synchronous | loop: until 3 attempts |
| 4 | User DB | Auth service | user row | Reply | loop: until 3 attempts |
| 5 | Auth service | Auth service | Verify password hash | Synchronous | loop: until 3 attempts |
| 6 | Auth service | Web app | 200 session token | Reply | loop: until 3 attempts<br>alt: password matches |
| 7 | Web app | User | Redirect to dashboard | Reply | loop: until 3 attempts<br>alt: password matches |
| 8 | Auth service | Web app | 401 invalid credentials | Reply | loop: until 3 attempts<br>alt else: password wrong |
| 9 | Web app | User | Show error | Reply | loop: until 3 attempts<br>alt else: password wrong |
| 10 | Web app | Auth service | Audit login attempt | Asynchronous | — |

## Notes

| No. | Note | Participant | Position | Placed after |
| --- | --- | --- | --- | --- |
| 1 | Rate limited per IP | Web app | Right | 1. Submit credentials |
| 2 | Hash: argon2id | Auth service, User DB | Over | 5. Verify password hash |
