# n8n Instagram-to-YouTube Shorts Automation Setup

This directory contains the production-ready n8n workflow for automated Instagram Reels detection, Google Drive storage, and YouTube Shorts uploading.

## Dynamic PostgreSQL Active Account Architecture

Instead of hardcoding account tokens or Instagram IDs inside n8n:
1. **Dynamic Lookup**: On every execution cycle, n8n queries `GET /api/n8n/active-account`.
2. **Instant Account Switching**: When you switch the active Creator account in the dashboard, n8n automatically targets the new account on its next scheduled run without requiring any workflow editing.
3. **Execution Concurrency Protection**: The workflow calls `POST /api/n8n/lock` before executing and `POST /api/n8n/unlock` when finished, preventing overlapping runs.
4. **Live Status Tracking**: Stage transitions (`DOWNLOADING`, `STORED_DRIVE`, `UPLOADING_YOUTUBE`, `COMPLETED`, `FAILED`) are reported back to the dashboard via `/api/n8n/upload-status`.

## How to Import the Workflow in n8n

1. Open your n8n web interface (e.g. `http://localhost:5678`).
2. Go to **Workflows** → Click **Add Workflow** → Click the three dots menu (⋮) in the top right.
3. Select **Import from File**.
4. Choose `n8n/workflows/instagram_to_youtube_shorts.json`.
5. Connect your credentials:
   - **Google Drive OAuth2** (for Google One storage)
   - **YouTube OAuth2** (for YouTube Shorts uploads)
6. Set the workflow to **Active**.
