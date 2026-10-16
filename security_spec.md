# Cycle.exe 2.0 — Security Specification & Invariants

## 1. Data Invariants

1. **Role Immutability from Client**: A user profile (`/users/{userId}`) can never have its `role`, `isSuspended`, or `id` created or modified by a non-Super Admin client request.
2. **PII Isolation**: `/users/{userId}/private/info` can only be read or written by the document owner or the Super Admin. It is never exposed in public lists.
3. **Post Publishing Role Gate**: Only users with verified `MEMBER`, `ADMIN`, or `SUPER_ADMIN` status can create posts. Public users are strictly forbidden from creating posts.
4. **Post Author Integrity**: The `authorId` on a post or comment must strictly equal `request.auth.uid`.
5. **Like Uniqueness & Permission Gate**: A like on `/posts/{postId}/likes/{userId}` can only be written by the authenticated user (`request.auth.uid == userId`) who has `MEMBER`, `ADMIN`, or `SUPER_ADMIN` role. Public users cannot write likes.
6. **Comment Deletion Exclusivity**: A comment can only be deleted by its author (`authorId == request.auth.uid`) or by the `SUPER_ADMIN`. Regular admins cannot delete other users' comments directly.
7. **Mission Modification Lock**: Only the `SUPER_ADMIN` can create, update, or delete documents in `/missions/{missionId}`.
8. **Invitation Code Secrecy**: Client SDK users cannot list or read `/invitationCodes`. Verification and redemption occur strictly through trusted backend procedures.
9. **Audit Trail Immutability**: Documents in `/auditLogs/{logId}` can only be read by the `SUPER_ADMIN` and can never be updated or deleted.
10. **Terminal & Status Locking**: Moderation reports in `/reports/{reportId}` can only be reviewed and resolved by `ADMIN` or `SUPER_ADMIN`.

## 2. The Dirty Dozen Malicious Payloads

1. **Self-Promotion Payload**: Unprivileged user attempting to register or update their own profile with `role: "SUPER_ADMIN"`.
2. **Ghost Field Injection**: User trying to inject `isAdmin: true` or `bypassed: true` into a post update.
3. **Public User Post Creation**: Authenticated user with role `PUBLIC` attempting to write to `/posts/malicious-post`.
4. **Author Spoofing**: User `attacker123` submitting a post with `authorId: "innocentVictim"`.
5. **Comment Deletion by Regular Admin**: Regular admin attempting to delete someone else's comment on `/posts/{p}/comments/{c}`.
6. **Like Forgery**: User `userA` attempting to write a like record at `/posts/{p}/likes/userB`.
7. **Direct Invitation Code Extraction**: Client trying to run `getDocs(collection(db, 'invitationCodes'))`.
8. **Mission Hijack**: Regular member or admin attempting to create or delete a `/missions/{id}` document.
9. **Private PII Scraping**: Attacker trying to list or read `/users/{victimId}/private/info`.
10. **Audit Log Tampering**: User attempting to clear or alter entries in `/auditLogs`.
11. **Negative Like Counter Manipulation**: Client trying to set `likesCount: -9999` or arbitrary integer.
12. **Mass Character Denial-of-Wallet Payload**: Client attempting to push a 500KB string into a comment's `text` field.

All of the above payloads must return `PERMISSION_DENIED` under the deployed Firestore Security Rules.
