# Security Checklist

## Stack

- React + TypeScript: frontend
- Supabase Auth: login and session management
- Supabase DB + RLS: data storage and access control
- Cloudflare Pages: deployment

## Environment Variables

- Store `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`.
- Keep `.env` out of Git.
- Register the same values in Cloudflare Pages environment variables.

## RLS

- Enable RLS on every table: `clients`, `contracts`, `payments`, `users`.
- Allow users to read and write only their assigned data.
- Use `users.role = 'admin'` for full admin access.
- Restrict all deletes to admins only.

## Auth

- Enable email verification in Supabase Auth.
- Disable resigned employee accounts immediately in the Supabase dashboard.
- Configure session expiration in Supabase Auth settings.
