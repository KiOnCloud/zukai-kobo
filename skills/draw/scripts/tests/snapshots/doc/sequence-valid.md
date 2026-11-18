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
| 1 | User | Web app | Submit credentials | Synchronous | Repeated: until 3 attempts |
| 2 | Web app | Auth service | POST /login | Synchronous | Repeated: until 3 attempts |
| 3 | Auth service | User DB | SELECT user by email | Synchronous | Repeated: until 3 attempts |
| 4 | User DB | Auth service | user row | Reply | Repeated: until 3 attempts |
| 5 | Auth service | Auth service | Verify password hash | Synchronous | Repeated: until 3 attempts |
| 6 | Auth service | Web app | 200 session token | Reply | Repeated: until 3 attempts<br>If password matches |
| 7 | Web app | User | Redirect to dashboard | Reply | Repeated: until 3 attempts<br>If password matches |
| 8 | Auth service | Web app | 401 invalid credentials | Reply | Repeated: until 3 attempts<br>Otherwise, if password wrong |
| 9 | Web app | User | Show error | Reply | Repeated: until 3 attempts<br>Otherwise, if password wrong |
| 10 | Web app | Auth service | Audit login attempt | Asynchronous | — |

## Notes

| No. | Note | Participant | Position | Placed after |
| --- | --- | --- | --- | --- |
| 1 | Rate limited per IP | Web app | Right | 1. Submit credentials |
| 2 | Hash: argon2id | Auth service, User DB | Over | 5. Verify password hash |
