# ThinkMark

> A lightweight, fast, and privacy-conscious web notebook for capturing, organizing, and accessing notes.

ThinkMark is a full-stack web application built with a simple frontend, a serverless API, and a managed database. It focuses on keeping the experience fast and minimal while maintaining secure authentication and efficient data handling.

## ✨ Features

* 🔐 Secure authentication with HttpOnly session cookies
* 📝 Create, edit, and delete notes
* 📚 Recent notes and all-notes views
* 🔗 Open notes using unique codes
* 🔄 Backlink support between notes
* 📱 Progressive Web App (PWA) support
* 🌐 Offline support through a service worker
* ⚡ Static assets served through Cloudflare's global network
* 🛡️ Security headers and Content Security Policy
* 🚀 Client-side state reuse to reduce unnecessary API requests

## 🛠️ Tech Stack

* **Frontend:** HTML, CSS, Vanilla JavaScript
* **Hosting:** Cloudflare Pages
* **Backend:** Cloudflare Pages Functions
* **Database:** Supabase
* **Authentication:** HttpOnly session cookies
* **PWA:** Service Worker + Web App Manifest
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

## ⚡ Performance

ThinkMark is designed to avoid unnecessary network requests.

Once notes are loaded, the frontend keeps them in local application state and reuses that data during normal navigation instead of repeatedly requesting the same list.

Mutations also update local state using the server response:

```text
Create
  ↓
POST /api/notes
  ↓
Update local state


Edit
  ↓
PUT /api/notes/:code
  ↓
Update local state


Delete
  ↓
DELETE /api/notes/:code
  ↓
Update local state
```

This reduces redundant API calls and Cloudflare Function invocations while keeping the server as the source of truth.

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

## 📱 PWA & Offline Support

ThinkMark includes:

* Web App Manifest
* Service Worker
* Static asset caching
* Offline application support

The service worker intentionally keeps API requests separate from static asset caching so authenticated dynamic data is not incorrectly treated as static content.

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

## ☁️ Deployment

ThinkMark is currently **not a centrally hosted public service**. The repository contains the application source code and deployment configuration needed to run your own instance.

ThinkMark can be **self-deployed** using your own infrastructure and credentials.

For example, the reference deployment uses:

- **Cloudflare Pages** — static frontend and serverless Functions
- **Supabase** — database
- **GitHub** — source control and deployment workflow

Each deployment is an independent ThinkMark instance. You are responsible for configuring and managing your own hosting, database, environment variables, and credentials.

### Development → Production

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
## 🧪 Testing

Before promoting a change to production, important application flows should be verified:

* Login and logout
* Session persistence after refresh
* Navigation between Home, All Notes, and Settings
* Creating a note
* Editing a note
* Deleting a note
* Opening individual notes
* Backlinks
* Offline/PWA behavior
* Static asset loading
* API request behavior

Particular attention should be paid to ensuring that normal navigation does not generate redundant `/api/notes` requests.

## 📌 Project Status

**Stable**

The `production` branch represents the current stable version of ThinkMark.

Development and experimental changes should be tested through the `main` branch and Cloudflare Preview deployments before being promoted to production.

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
* Cloudflare Pages
* Performance optimization
* Secure web application architecture
