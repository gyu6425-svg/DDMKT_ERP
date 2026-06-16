# Marketing ERP Dashboard

Internal ERP for company marketing operations.

## Stack

- React + TypeScript
- Supabase Auth
- Supabase DB + RLS
- Cloudflare Pages

## Local Setup

Create `.env` in the project root.

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Run locally:

```sh
npm run dev
```

Build check:

```sh
npm run build
```

## Project Notes

- Project context: `docs/project-context.md`
- Error tracking guide: `docs/troubleshooting.md`
- Security checklist: `docs/security-checklist.md`
- Supabase RLS SQL: `docs/supabase-rls.sql`

## Security Rule

Frontend UI is not the security boundary. Access control must be enforced through Supabase RLS.
