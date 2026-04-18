# 🌬️ VayuPath — AQI Smart Route Optimizer

> **College Mini Project | Full-Stack Web Application**  
> Find the least polluted travel route between Indian cities using real-time Air Quality Index data.

---

## 📋 Project Overview

**VayuPath** is a full-stack web application that helps travelers choose the cleanest air route between two Indian cities. It fetches real-time AQI (Air Quality Index) data for waypoints along multiple route variants, scores each route by pollution exposure + distance, and recommends the optimal path.

### 🎯 Key Features

| Feature | Description |
|---|---|
| 🗺️ Interactive Map | Leaflet.js map with multiple colored route overlays |
| 🌬️ Real-time AQI | Live AQI data via WAQI API (with smart simulation fallback) |
| 🤖 AI Predictions | AQI forecast for next 6 hours using trend modeling |
| 🏥 Hospital Finder | Nearby hospitals via OpenStreetMap Overpass API |
| 🔥 AQI Heatmap | Visual pollution heatmap overlay |
| 📥 PDF Reports | Printable route report with full AQI breakdown |
| 🎤 Voice Input | Speech recognition for city input |
| 👤 User Accounts | Register/Login with saved routes |
| ⭐ Save Routes | Save and manage favorite routes |
| 🌙 Dark/Light Mode | Theme toggle with persistence |
| 📱 Responsive | Mobile-friendly layout |

---

## 🗂️ Project Structure

```
vayupath/
├── app.py                  # Flask backend (all API routes + DB models)
├── requirements.txt        # Python dependencies
├── README.md
├── instance/
│   └── vayupath.db         # SQLite database (auto-created)
├── templates/
│   ├── index.html          # Main app page (map + sidebar)
│   └── login.html          # Auth page (sign in / register)
└── static/
    ├── css/
    │   └── style.css       # Main stylesheet (dark/light themes)
    └── js/
        └── app.js          # Frontend JavaScript (map, API calls, UI)
```

---

## ⚙️ Setup & Installation

### Prerequisites
- Python 3.8 or higher
- pip (Python package manager)
- Internet connection (for maps and AQI API)

### Step 1: Clone / Extract the project
```bash
cd vayupath
```

### Step 2: Create a virtual environment (recommended)
```bash
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (Mac/Linux)
source venv/bin/activate
```

### Step 3: Install dependencies
```bash
pip install -r requirements.txt
```

### Step 4: (Optional) Get a Free AQI API Key
1. Visit https://aqicn.org/api/
2. Register for a free account
3. Copy your API token
4. Open `app.py` and replace:
   ```python
   WAQI_API_KEY = "demo"
   ```
   with:
   ```python
   WAQI_API_KEY = "your_actual_key_here"
   ```

> **Note:** The app works without an API key using intelligent AQI simulation based on India's regional pollution patterns. Perfect for demos!

### Step 5: Run the application
```bash
python app.py
```

### Step 6: Open in browser
```
http://localhost:5000
```

---

## 🚀 How to Use

1. **Sign In** — Use demo account (`demo@vayupath.com` / `demo123`) or create a new account
2. **Enter Cities** — Type source and destination Indian cities
3. **Find Routes** — Click "Find Optimal Route" — the system fetches AQI for all waypoints
4. **Compare Routes** — View 3 route options with AQI scores, distance, and travel time
5. **View Map** — Routes are color-coded; click AQI markers for detailed info
6. **Enable Heatmap** — Toggle the AQI Heatmap switch for a pollution overlay
7. **Find Hospitals** — Click "Nearby Hospitals" to see hospitals along the route
8. **Download Report** — Click "Download PDF Report" for a printable summary
9. **Save Route** — Star a route to save it for future reference

---

## 🧠 Route Scoring Algorithm

Each route is scored using a weighted composite formula:

```
Score = (Avg AQI × 0.60) + (Distance × 0.025 × 0.25) + (Hazardous Zones × 15 × 0.15)
```

- **60% weight on AQI** — Pollution exposure is the primary factor
- **25% weight on Distance** — Shorter routes preferred (normalized)
- **15% weight on Hazardous Zones** — Each zone with AQI > 200 penalizes score

The route with the **lowest score** is recommended.

---

## 🌐 APIs Used

| API | Purpose | Cost |
|---|---|---|
| WAQI API | Real-time AQI data | Free tier available |
| Nominatim (OpenStreetMap) | City geocoding | 100% Free |
| Overpass API | Hospital locations | 100% Free |
| CartoDB Tiles | Map background | 100% Free |
| Web Speech API | Voice input | Built into browser |

---

## 🎨 AQI Color Scale

| AQI Range | Category | Color | Action |
|---|---|---|---|
| 0–50 | Good | 🟢 Green | No precautions |
| 51–100 | Moderate | 🟡 Yellow | Sensitive groups be careful |
| 101–150 | Unhealthy (Sensitive) | 🟠 Orange | Wear masks |
| 151–200 | Unhealthy | 🔴 Red | N95 masks recommended |
| 201–300 | Very Unhealthy | 🟣 Purple | Minimize outdoor time |
| 300+ | Hazardous | ⬛ Dark | Emergency! Stay indoors |

---

## 👤 Demo Account
- **Email:** demo@vayupath.com  
- **Password:** demo123

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python + Flask |
| Database | SQLite + SQLAlchemy ORM |
| Frontend | HTML5, CSS3, JavaScript (ES6+) |
| Maps | Leaflet.js |
| Fonts | Syne (headings) + DM Sans (body) |
| AQI Data | WAQI API + Nominatim |
| PDF | Browser Print API |
| Voice | Web Speech Recognition API |

---

## 📌 Notes for College Submission

- This project demonstrates: REST API design, database ORM, real-time data fetching, geospatial calculations, responsive UI, and user authentication
- The AQI simulation engine uses real India-region pollution patterns based on latitude/longitude
- Voice input uses the browser's built-in Web Speech API (works in Chrome)
- PDF export uses the browser's print API — no external library needed
- All external APIs used are either free or have generous free tiers

---

*Built with ❤️ using Flask + Leaflet.js | VayuPath — Breathe Easy, Travel Smart*
