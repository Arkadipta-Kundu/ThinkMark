# ThinkMark

> A lightweight, fast, and privacy-conscious web notebook for capturing, organizing, and accessing notes.

ThinkMark is a full-stack web application built with a simple frontend, a serverless API, and a managed database. It focuses on keeping the experience fast and minimal while maintaining secure authentication, reliable note recovery, efficient data handling, and a low-request architecture.

ThinkMark is **not currently operated as a centrally hosted public service**. It is designed to be **self-deployed**, allowing you to run your own independent instance using your own hosting, database, and credentials.

## ✨ Features

* 🔐 Secure authentication with HttpOnly session cookies
* 📝 Create, edit, and delete notes
* 📚 Recent notes and All Notes views
* 🔗 Open notes using unique codes
* 🔄 Backlink support between notes
* 💾 Local autosave for unsaved writing
* ♻️ Recovery of interrupted new-note writing
* ✏️ Recovery of unsaved edits to existing notes
* ⚠️ Confirmation before permanently discarding recovered writing
* 📱 Progressive Web App (PWA) support
* 🌐 Offline support through a service worker
* ⚡ Static assets served through Cloudflare's global network
* 🛡️ Security headers and Content Security Policy
* 🚀 Client-side state reuse to reduce unnecessary API requests
* 🔄 Request deduplication for simultaneous note-list requests
* 📦 Local state updates after create, edit, and delete operations
* 🎨 Adjustable navigation typography
* 📖 Adjustable note-reading and editor typography
* 🌓 Dark-mode-aware interface and loading experience

## 🛠️ Tech Stack

* **Frontend:** HTML, CSS, Vanilla JavaScript
* **Hosting:** Cloudflare Pages
* **Backend:** Cloudflare Pages Functions
* **Database:** Supabase
* **Authentication:** HttpOnly session cookies
* **PWA:** Service Worker + Web App Manifest
* **Local recovery:** Browser `localStorage`
* **Version Control:** Git + GitHub

## 🏗️ Architecture

```text
                         ┌─────────────────┐
                         │     Browser     │
                         │                 │
                         │ HTML / CSS / JS │
                         │ Service Worker  │
                         └────────┬────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              Static assets                 /api/*
                    │                           │
                    ▼                           ▼
          ┌─────────────────┐        ┌──────────────────┐
          │ Cloudflare Pages│        │ Pages Functions  │
          │      / CDN      │        │                  │
          └─────────────────┘        │ Auth + Notes API │
                                     └────────┬─────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │    Supabase     │
                                     │    Database     │
                                     └─────────────────┘
```

Static files are served directly by Cloudflare Pages, while only `/api/*` requests invoke server-side Functions.

The frontend maintains application state locally during normal navigation, reducing repeated requests for data that is already available.

## 📁 Project Structure

```text
ThinkMark/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── sw.js
│   ├── manifest.webmanifest
│   ├── _headers
│   ├── _routes.json
│   └── assets/
│
├── functions/
│   ├── _middleware.js
│   └── api/
│       ├── _auth.js
│       ├── auth/
│       │   ├── login.js
│       │   ├── logout.js
│       │   └── session.js
│       └── notes/
│           ├── index.js
│           └── [code].js
│
├── package.json
├── .gitignore
├── LICENSE
└── README.md
```

## 🔌 API

### Authentication

| Method   | Endpoint            | Description                |
| -------- | ------------------- | -------------------------- |
| `POST`   | `/api/auth/login`   | Authenticate a user        |
| `POST`   | `/api/auth/logout`  | End the current session    |
| `GET`    | `/api/auth/session` | Check authentication state |
| `POST`   | `/api/auth/session` | Session operation          |
| `DELETE` | `/api/auth/session` | Session operation          |

### Notes

| Method   | Endpoint           | Description              |
| -------- | ------------------ | ------------------------ |
| `GET`    | `/api/notes`       | Retrieve notes           |
| `POST`   | `/api/notes`       | Create a note            |
| `GET`    | `/api/notes/:code` | Retrieve a specific note |
| `PUT`    | `/api/notes/:code` | Update a note            |
| `DELETE` | `/api/notes/:code` | Delete a note            |

## ⚡ Performance & Request Optimization

ThinkMark is intentionally designed to avoid unnecessary network requests.

### Client-side note state

Once the note list has been loaded, the frontend keeps the notes in application state and reuses that data during normal navigation.

For example:

```text
First Home load
      ↓
GET /api/notes
      ↓
Store notes locally
      ↓
Home → All Notes → Settings → Home
      ↓
Reuse existing state
      ↓
No additional /api/notes request
```

### Request deduplication

If multiple parts of the application request the note list at approximately the same time, the same in-flight request can be reused rather than generating multiple identical requests.

### Mutations update local state

Create:

```text
POST /api/notes
      ↓
Server returns created note
      ↓
Insert into local state
```

Edit:

```text
PUT /api/notes/:code
      ↓
Server returns updated note
      ↓
Update local state
```

Delete:

```text
DELETE /api/notes/:code
      ↓
Remove note from local state
```

This avoids unnecessary follow-up requests such as refetching the entire note list after every mutation.

The server remains the source of truth while the client avoids unnecessary synchronization requests.

## 💾 Local Autosave & Recovery

ThinkMark includes a browser-side autosave mechanism designed to protect writing from accidental navigation, browser closure, or interrupted sessions.

Autosave uses `localStorage` and **does not make API requests while the user is typing**.

### New notes

Unsaved new-note content is stored locally under:

```text
thinkmark.editor.new
```

Once the note is successfully created:

```text
Editor
  ↓
Local autosave
  ↓
POST /api/notes
  ↓
Server confirms creation
  ↓
Update local application state
  ↓
Remove local new-note draft
```

A successfully saved note therefore does not remain as an old "new note" recovery draft.

### Existing notes

Unsaved edits are stored separately for each note:

```text
thinkmark.editor.note.<code>
```

The local draft is removed only after the corresponding `PUT /api/notes/:code` succeeds.

### Recovery

When a valid local draft is detected, ThinkMark can present:

```text
Unsaved note found

[Continue writing] [Discard]
```

Choosing **Continue writing** restores the local draft.

Choosing **Discard** opens the existing note-deletion confirmation interface before permanently removing the local draft.

Discarding a recovery draft:

* Does not delete the server-side note
* Does not call the Notes API
* Only removes the corresponding local `localStorage` entry

This keeps local recovery separate from permanent server-side deletion.

## 📱 PWA & Offline Support

ThinkMark includes:

* Web App Manifest
* Service Worker
* Installable PWA support
* Static asset caching
* Offline application support
* Local writing recovery

The service worker intentionally keeps API requests separate from static asset caching so authenticated dynamic data is not incorrectly treated as static content.

Local autosave also allows writing to continue without requiring an active network connection. Server synchronization still occurs through the normal explicit save/create operations.

## 🎨 User Experience

ThinkMark keeps the interface intentionally minimal while providing controls for comfortable use.

### Typography

Navigation typography can be adjusted independently from note-writing typography.

The editor and note-reading experience support their own appropriate text sizing so long notes remain comfortable to read and edit.

### Loading experience

The application uses an explicit authentication-loading state during startup rather than immediately displaying the login interface while the existing session is being checked.

This prevents the logged-in user from seeing an unnecessary login-page flash during application initialization.

## 🔒 Security

Authentication is handled server-side using secure HttpOnly cookies.

Session cookies use security-focused attributes including:

```text
HttpOnly
Secure
SameSite=Strict
Path=/
```

Database credentials remain on the server and are not exposed to the browser.

Static responses are protected using security headers including:

* Content Security Policy
* Referrer Policy
* X-Content-Type-Options
* X-Frame-Options
* Permissions Policy

API responses retain their server-side security handling through Cloudflare Pages Functions.

The static Content Security Policy permits the same-origin service worker while the API-side policy can remain stricter because API responses do not register browser workers.

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Arkadipta-Kundu/ThinkMark.git
cd ThinkMark
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Configure the required server-side environment variables for the Cloudflare Pages Functions and Supabase connection.

Do **not** commit secrets or production credentials to Git.

### 4. Start the development server

```bash
npm run dev
```

The project uses Cloudflare's local Pages development environment.

## ☁️ Self-Deployment

ThinkMark is currently **not a centrally hosted public service**.

The repository contains the application source code and deployment configuration needed to run your own instance.

You can self-deploy ThinkMark using your own infrastructure and credentials.

The reference deployment uses:

* **Cloudflare Pages** — static frontend and serverless Functions
* **Supabase** — database
* **GitHub** — source control and deployment workflow

Each deployment is an independent ThinkMark instance. You are responsible for configuring and managing your own:

* Hosting
* Database
* Environment variables
* Authentication configuration
* Credentials
* Domains
* Deployment pipeline

## 🔄 Development → Production

The repository uses separate development and production branches:

```text
main
 │
 │ development / testing
 ▼
Cloudflare Preview
 │
 │ stable changes
 ▼
production
 │
 ▼
Live application
```

The `main` branch is used for development and testing.

The `production` branch represents the stable version deployed to the live environment.

Cloudflare Preview deployments can be used to validate changes before promoting stable changes to production.

## 🧪 Testing

Before promoting a change to production, important application flows should be verified.

### Authentication

* Login
* Logout
* Session persistence after refresh
* No protected data remaining visible after logout

### Navigation

* Home
* All Notes
* Settings
* Repeated navigation between views
* No unexpected duplicate `/api/notes` requests

### Notes

* Create a note
* Edit a note
* Delete a note
* Open individual notes
* Backlinks
* Correct title/content display on note cards

### Autosave & recovery

* New-note autosave
* Existing-note edit autosave
* Recovery after accidental navigation
* Continue writing
* Discard confirmation
* Cancel/Continue writing from the confirmation
* Successful save clearing the corresponding local draft
* Failed save preserving the local draft
* No accidental restoration of previously saved notes as new-note drafts

### PWA

* Installation
* Service worker registration
* Static asset loading
* Offline behavior

### Performance

Particular attention should be paid to ensuring that normal navigation and note mutations do not generate redundant API requests.

## 📌 Project Status

**Stable**

The `production` branch represents the current stable version of ThinkMark.

Development and experimental changes should be tested through the `main` branch and Cloudflare Preview deployments before being promoted to production.

ThinkMark is currently intended primarily as a **self-deployable software project rather than a centrally hosted public service**.

## 📄 License

ThinkMark is licensed under the MIT License.

See [LICENSE](LICENSE) for the full license text.

## 👨‍💻 About

ThinkMark is a personal software engineering project built to explore practical web application development, including:

* Frontend state management
* Serverless APIs
* Authentication
* Database-backed applications
* Progressive Web Apps
* Offline-first recovery techniques
* Client-side request optimization
* Cloudflare Pages
* Performance optimization
* Secure web application architecture
* Practical software engineering and deployment workflows
