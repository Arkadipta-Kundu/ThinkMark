# ThinkMark

A minimal physical-to-digital notebook extension app.

## Architecture

- Frontend: Vanilla HTML/CSS/JS
- Hosting/API: Cloudflare Pages + Pages Functions
- Database: Supabase PostgreSQL
- Cost target: ₹0/month on free tiers

## 1. Supabase

Create a Supabase project and run `supabase/schema.sql` in the SQL Editor.

Then get:
- Project URL
- Secret key from Settings → API Keys

Never put the Supabase secret key in frontend code.

## 2. Cloudflare

Create a GitHub repository and push this project.

In Cloudflare:
1. Workers & Pages → Create → Pages → Connect to Git
2. Select the repository.
3. Build command: leave empty
4. Build output directory: `public`
5. Deploy.

The `functions/` directory is detected as Pages Functions.

## 3. Environment variables

In Cloudflare Pages → Settings → Environment variables, add:

- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SECRET_KEY` = your Supabase secret key
- `THINKMARK_PASSWORD` = a private password for your personal ThinkMark

Add them for Production (and Preview if you want).

Do NOT commit these values to GitHub.

## 4. First use

Open the deployed site.
Enter your ThinkMark password.
Tap New Note.
Write your extension.
Save.
Copy the generated 4-character code into your physical notebook.

Later, enter the code on the home page to retrieve it.

## Existing data migration

This app now expects note codes to be exactly 4 lowercase alphanumeric characters (`a-z`, `0-9`).

If your database already contains 5-character codes, do not change the schema in place without a plan:

- Existing 5-character rows will fail the new `varchar(4)` and regex check.
- The app will reject 5-character codes after this change.
- You must migrate those records explicitly, for example by assigning each legacy row a new unique 4-character code and updating the matching physical notebook references before enforcing the new schema.

Do not truncate 5-character codes automatically, because truncation can create collisions and break existing references.

## Local development

Install Node.js and Wrangler:

    npm install

Then create a `.dev.vars` file in the project root:

    SUPABASE_URL=https://YOUR_PROJECT.supabase.co
    SUPABASE_SECRET_KEY=YOUR_SECRET_KEY
    THINKMARK_PASSWORD=YOUR_PASSWORD

Start:

    npm run dev

This runs the Pages project locally.

## Important

The Supabase secret key has full database access and must remain server-side. The browser only talks to `/api/*`.

For long-term safety, periodically export your notes from the Settings menu.
# ThinkMark
