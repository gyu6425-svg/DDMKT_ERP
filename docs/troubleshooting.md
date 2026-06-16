# Troubleshooting

Use this file when an error appears, the page is blank, login fails, or data does not load.

## First Checks

1. Confirm the dev server is running.

```sh
npm run dev
```

2. Confirm `.env` exists in the project root.

Required values:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

3. Restart the dev server after changing `.env`.

4. Open the browser console and copy the first error message.

5. Run a production build check.

```sh
npm run build
```

## Common Issues

### Blank page

Likely causes:

- Missing `VITE_SUPABASE_URL`
- Missing `VITE_SUPABASE_PUBLISHABLE_KEY`
- Runtime error in browser console
- Login redirect loop

Check:

- `src/lib/supabase.ts`
- `.env`
- Browser console
- Network tab

### Redirects to login

Likely cause:

- No active Supabase Auth session.

Check:

- `src/components/ProtectedRoute.tsx`
- `src/context/AuthContext.tsx`
- Supabase Auth user exists and is enabled

### Data not showing

Likely causes:

- RLS policy blocks the current user
- `users.id` does not match `auth.uid()`
- `clients.담당자_id` does not match the logged-in user id
- Admin user does not have `role = 'admin'`

Check:

- Supabase SQL Editor
- `docs/supabase-rls.sql`
- Table rows for `users`, `clients`, `contracts`, `payments`

### Works locally but not on Cloudflare Pages

Likely causes:

- Cloudflare Pages environment variables are missing
- Production Supabase URL or anon key is wrong
- Redirect URL is not configured in Supabase Auth

Check:

- Cloudflare Pages environment variables
- Supabase Auth URL configuration
- Deployment logs

## Error Report Template

```txt
Date:
Page URL:
Action before error:
Browser console error:
Network error:
Logged-in user email:
Supabase user id:
Expected result:
Actual result:
Recent files changed:
```

## Useful Files

- `src/lib/supabase.ts`: Supabase client
- `src/context/AuthContext.tsx`: session state
- `src/hooks/useAuth.ts`: auth hook
- `src/components/ProtectedRoute.tsx`: login guard
- `src/App.tsx`: route selection
- `docs/supabase-rls.sql`: RLS policies
- `docs/security-checklist.md`: security checklist
- `docs/project-context.md`: project context
