# Nirmala Transport - Transport Management & Billing System

A modern Logistics & Transport Management software built with React, TypeScript, Tailwind CSS, and Firebase Firestore.

## 🚀 Features

- **Billing & Invoices**:
  - Tax Invoices & Standard Invoices (GST slabs 0%, 5%, 12%, 18%, 28%)
  - Sales Bills & Purchase Bills with automated stock sync
  - Excel Bulk Import / Export & Native PDF Print
- **Ledgers & Accounts**:
  - Party Ledgers with credit/debit balance tracking & Kasar adjustments
  - Truck/Vehicle Ledgers for fuel, maintenance, trips, and profits
  - Lump-sum and direct invoice payment receipts
- **Inventory & Stock Management**:
  - Stock in/out adjustments, product tracking, and low-stock indicators
- **Tax Reports**:
  - GST Sales Register, Purchase Register, Summary reports & GSTR-1 preparation
- **Multi-Role Access**:
  - Admin, Accountant, Transporter Manager, and Driver Mobile View
- **Realtime Cloud Sync**:
  - Powered by Firebase Firestore for multi-device sync

---

## 🛠️ GitHub Actions Workflows

We have configured GitHub Actions in `.github/workflows/`:

1. **Deploy to GitHub Pages (`deploy.yml`)**
   - Automatically builds and deploys your site to GitHub Pages on every push to `main` or `master`.
   - To enable: Go to **Settings** > **Pages** > Select **Source: GitHub Actions**.

2. **Build & CI Check (`build-ci.yml`)**
   - Automatically runs TypeScript type checks and verifies production builds.
   - Can be triggered manually from the **Actions** tab.

3. **Production Release (`release.yml`)**
   - Creates a new release under **Releases** with a zip archive containing the built web application.
   - Can be triggered manually from the **Actions** tab with your custom version number (e.g. `v1.0.0`).

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Build for production
npm run build
```
