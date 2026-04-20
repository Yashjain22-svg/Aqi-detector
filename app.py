"""
VayuPath - AQI Smart Route Optimizer
Flask Backend Application (Optimized & Error-Free)
"""

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import requests
import json
import os
import math
import random
from datetime import datetime, timedelta
from functools import wraps

basedir = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'vayupath_secret_key_2024')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'vayupath.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ============================================================
# API KEYS
# ============================================================
WAQI_API_KEY = os.environ.get('WAQI_API_KEY', 'demo')

# ============================================================
# DATABASE MODELS
# ============================================================

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    routes = db.relationship('SavedRoute', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class SavedRoute(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    source = db.Column(db.String(200), nullable=False)
    destination = db.Column(db.String(200), nullable=False)
    route_data = db.Column(db.Text)
    avg_aqi = db.Column(db.Float)
    distance = db.Column(db.Float)
    saved_at = db.Column(db.DateTime, default=datetime.utcnow)
    nickname = db.Column(db.String(100))


class AQICache(db.Model):
    """Caches real AQI data for 1 hour to prevent API rate limiting."""
    id = db.Column(db.Integer, primary_key=True)
    lat = db.Column(db.Float, nullable=False, index=True)
    lon = db.Column(db.Float, nullable=False, index=True)
    aqi = db.Column(db.Integer, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)


# ============================================================
# AUTH DECORATOR
# ============================================================

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Login required'}), 401
        return f(*args, **kwargs)
    return decorated


# ============================================================
# AQI HELPER FUNCTIONS
# ============================================================

def get_aqi_category(aqi):
    """Return AQI category, color, and health advice."""
    if aqi is None:
        return {'label': 'Unknown', 'color': '#888888', 'hex': '888888', 'advice': 'No data available'}
    aqi = int(aqi)
    if aqi <= 50:
        return {'label': 'Good', 'color': '#00C853', 'hex': '00C853', 'advice': 'Air quality is satisfactory. No precautions needed.'}
    elif aqi <= 100:
        return {'label': 'Moderate', 'color': '#FFD600', 'hex': 'FFD600', 'advice': 'Sensitive individuals should limit outdoor exertion.'}
    elif aqi <= 150:
        return {'label': 'Unhealthy for Sensitive Groups', 'color': '#FF6D00', 'hex': 'FF6D00', 'advice': 'Wear N95 mask. Sensitive groups avoid prolonged outdoor activity.'}
    elif aqi <= 200:
        return {'label': 'Unhealthy', 'color': '#D50000', 'hex': 'D50000', 'advice': 'Everyone should wear N95 mask. Avoid prolonged outdoor exposure.'}
    elif aqi <= 300:
        return {'label': 'Very Unhealthy', 'color': '#6A0080', 'hex': '6A0080', 'advice': 'Health emergency. Wear N95/N99 mask. Minimize outdoor time.'}
    else:
        return {'label': 'Hazardous', 'color': '#3E2723', 'hex': '3E2723', 'advice': 'DANGER! Stay indoors. Use air purifiers. Emergency masks required.'}


def fetch_aqi_for_coords(lat, lon):
    """Fetch real AQI from WAQI API with Database Caching."""
    if WAQI_API_KEY == 'demo':
        print("WARNING: Using demo key. Real AQI fetch will likely fail.")
        
    # Round coordinates to 2 decimal places (approx 1.1km resolution) for caching
    r_lat, r_lon = round(lat, 2), round(lon, 2)
    
    # 1. Check Database Cache (Is there data from the last hour?)
    cutoff_time = datetime.utcnow() - timedelta(hours=1)
    cached_data = AQICache.query.filter_by(lat=r_lat, lon=r_lon).filter(AQICache.timestamp >= cutoff_time).first()
    
    if cached_data:
        return cached_data.aqi

    # 2. Fetch from Real API
    try:
        url = f"https://api.waqi.info/feed/geo:{lat};{lon}/?token={WAQI_API_KEY}"
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        
        if data.get('status') == 'ok':
            aqi_val = data['data'].get('aqi')
            if isinstance(aqi_val, (int, float)):
                final_aqi = int(aqi_val)
                
                # 3. Save real data to database for future routes
                new_cache = AQICache(lat=r_lat, lon=r_lon, aqi=final_aqi)
                db.session.add(new_cache)
                db.session.commit()
                
                return final_aqi
        return None
    except Exception as e:
        print(f"API Error for {lat},{lon}: {e}")
        return None


def fetch_aqi_for_city(city_name):
    """Fetch real AQI data from WAQI API for a city name."""
    try:
        url = f"https://api.waqi.info/feed/{city_name}/?token={WAQI_API_KEY}"
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        if data.get('status') == 'ok':
            aqi_val = data['data'].get('aqi')
            if isinstance(aqi_val, (int, float)):
                return int(aqi_val)
        return None
    except Exception as e:
        print(f"API Error for {city_name}: {e}")
        return None


def simulate_aqi_for_coords(lat, lon):
    """
    Simulate realistic AQI values when real API is unavailable.
    Uses lat/lon as seed for reproducible results.
    """
    rng = random.Random(int((abs(lat) * 1000 + abs(lon) * 1000)) % 99991)

    if lat > 25 and 72 < lon < 88:
        base_aqi = rng.randint(100, 280)
    elif 18 < lat <= 25:
        base_aqi = rng.randint(60, 180)
    else:
        base_aqi = rng.randint(40, 130)

    variation = rng.randint(-20, 20)
    return max(10, base_aqi + variation)


def geocode_city(city_name):
    """Convert city name to (lat, lon) using Nominatim (free, no key needed)."""
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {'q': city_name + ', India', 'format': 'json', 'limit': 1}
        headers = {'User-Agent': 'VayuPath-AQI-App/1.0'}
        resp = requests.get(url, params=params, headers=headers, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        if data:
            return float(data[0]['lat']), float(data[0]['lon'])
        return None, None
    except Exception:
        return None, None


def interpolate_waypoints(lat1, lon1, lat2, lon2, num_points=6):
    """Generate intermediate waypoints between two coordinates."""
    points = []
    total = num_points + 1
    for i in range(total + 1):
        t = i / total
        lat = lat1 + t * (lat2 - lat1)
        lon = lon1 + t * (lon2 - lon1)
        points.append((round(lat, 4), round(lon, 4)))
    return points


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate great-circle distance in km between two coordinates."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def generate_route_variants(lat1, lon1, lat2, lon2):
    """Generate 3 route variants: direct, northern detour, southern detour."""
    mid_lon = (lon1 + lon2) / 2
    routes = [
        {
            'name': 'Direct Route',
            'points': interpolate_waypoints(lat1, lon1, lat2, lon2, 6),
            'type': 'direct'
        },
        {
            'name': 'Northern Route',
            'points': (
                interpolate_waypoints(lat1, lon1, (lat1 + lat2) / 2 + 1.2, mid_lon, 3) +
                interpolate_waypoints((lat1 + lat2) / 2 + 1.2, mid_lon, lat2, lon2, 3)[1:]
            ),
            'type': 'north'
        },
        {
            'name': 'Southern Route',
            'points': (
                interpolate_waypoints(lat1, lon1, (lat1 + lat2) / 2 - 1.2, mid_lon, 3) +
                interpolate_waypoints((lat1 + lat2) / 2 - 1.2, mid_lon, lat2, lon2, 3)[1:]
            ),
            'type': 'south'
        }
    ]
    return routes


def predict_aqi_trend(current_aqi):
    """Predict AQI for the next 6 hours based on time-of-day patterns."""
    rng = random.Random(current_aqi)
    predictions = []
    val = current_aqi
    for h in range(1, 7):
        hour = (datetime.now().hour + h) % 24
        if 6 <= hour <= 10 or 17 <= hour <= 21:
            change = rng.randint(-5, 20)
        elif 11 <= hour <= 16:
            change = rng.randint(-15, 5)
        else:
            change = rng.randint(-10, 10)
        val = max(5, val + change)
        predictions.append({
            'hour': f"{hour:02d}:00",
            'aqi': val,
            'category': get_aqi_category(val)
        })
    return predictions


def calculate_route_score(avg_aqi, total_distance, hazardous_zones, avoid_polluted=False):
    """Composite score: lower is better."""
    hazard_weight = 0.40 if avoid_polluted else 0.15
    aqi_weight = 0.45 if avoid_polluted else 0.60
    score = (avg_aqi * aqi_weight) + (total_distance * 0.00025 * 100) + (hazardous_zones * 15 * hazard_weight)
    return round(score, 2)


# ============================================================
# ROUTE HANDLERS
# ============================================================

@app.route('/')
def index():
    user = None
    if 'user_id' in session:
        user = db.session.get(User, session['user_id'])
    return render_template('index.html', user=user)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return render_template('login.html')

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Invalid request'}), 400

    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    user = User.query.filter_by(email=email).first()
    if user and user.check_password(password):
        session['user_id'] = user.id
        session['username'] = user.username
        return jsonify({'success': True, 'username': user.username})

    return jsonify({'success': False, 'error': 'Invalid email or password'}), 401


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Invalid request'}), 400

    username = data.get('username', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not username or not email or not password:
        return jsonify({'success': False, 'error': 'All fields required'}), 400
    if len(password) < 6:
        return jsonify({'success': False, 'error': 'Password must be at least 6 characters'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'error': 'Email already registered'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'error': 'Username already taken'}), 400

    try:
        user = User(username=username, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        session['username'] = user.username
        return jsonify({'success': True, 'username': user.username})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Registration failed. Please try again.'}), 500


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/api/find-routes', methods=['POST'])
def find_routes():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    source = data.get('source', '').strip()
    destination = data.get('destination', '').strip()
    avoid_polluted = bool(data.get('avoid_polluted', False))

    if not source or not destination:
        return jsonify({'error': 'Source and destination required'}), 400

    if source.lower() == destination.lower():
        return jsonify({'error': 'Source and destination cannot be the same'}), 400

    src_lat, src_lon = geocode_city(source)
    dst_lat, dst_lon = geocode_city(destination)

    if not src_lat:
        return jsonify({'error': f'Could not locate "{source}". Try adding ", India" to the name.'}), 400
    if not dst_lat:
        return jsonify({'error': f'Could not locate "{destination}". Try adding ", India" to the name.'}), 400

    route_variants = generate_route_variants(src_lat, src_lon, dst_lat, dst_lon)
    processed_routes = []

    for route in route_variants:
        waypoints_data = []
        aqi_values = []

        for (lat, lon) in route['points']:
            aqi = fetch_aqi_for_coords(lat, lon)
            if aqi is None:
                aqi = simulate_aqi_for_coords(lat, lon)

            category = get_aqi_category(aqi)
            waypoints_data.append({'lat': lat, 'lon': lon, 'aqi': aqi, 'category': category})
            aqi_values.append(aqi)

        pts = route['points']
        total_distance = sum(
            haversine_distance(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
            for i in range(len(pts) - 1)
        )

        avg_aqi = round(sum(aqi_values) / len(aqi_values), 1)
        max_aqi = max(aqi_values)
        hazardous_zones = sum(1 for a in aqi_values if a > 200)

        travel_time_hrs = total_distance / 50
        travel_time_str = f"{int(travel_time_hrs)}h {int((travel_time_hrs % 1) * 60)}m"

        score = calculate_route_score(avg_aqi, total_distance, hazardous_zones, avoid_polluted)
        aqi_prediction = predict_aqi_trend(aqi_values[0])

        processed_routes.append({
            'name': route['name'],
            'type': route['type'],
            'waypoints': waypoints_data,
            'avg_aqi': avg_aqi,
            'max_aqi': max_aqi,
            'distance_km': round(total_distance, 1),
            'travel_time': travel_time_str,
            'hazardous_zones': hazardous_zones,
            'score': score,
            'aqi_category': get_aqi_category(avg_aqi),
            'aqi_prediction': aqi_prediction,
            'is_recommended': False
        })

    processed_routes.sort(key=lambda r: r['score'])
    processed_routes[0]['is_recommended'] = True

    return jsonify({
        'success': True,
        'source': {'name': source, 'lat': src_lat, 'lon': src_lon},
        'destination': {'name': destination, 'lat': dst_lat, 'lon': dst_lon},
        'routes': processed_routes,
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })


@app.route('/api/aqi-live/<city>')
def aqi_live(city):
    aqi = fetch_aqi_for_city(city)
    using_simulation = aqi is None
    if using_simulation:
        lat, lon = geocode_city(city)
        aqi = simulate_aqi_for_coords(lat, lon) if lat else 100

    return jsonify({
        'city': city,
        'aqi': aqi,
        'category': get_aqi_category(aqi),
        'prediction': predict_aqi_trend(aqi),
        'simulated': using_simulation,
        'timestamp': datetime.now().strftime('%H:%M:%S')
    })


@app.route('/api/nearby-hospitals', methods=['POST'])
def nearby_hospitals():
    data = request.get_json()
    if not data:
        return jsonify({'hospitals': [], 'error': 'Invalid request'}), 400

    lat = data.get('lat')
    lon = data.get('lon')
    if lat is None or lon is None:
        return jsonify({'hospitals': [], 'error': 'lat and lon required'}), 400

    radius = data.get('radius', 5000)

    try:
        query = f"""
        [out:json][timeout:10];
        (
          node["amenity"="hospital"](around:{radius},{lat},{lon});
          way["amenity"="hospital"](around:{radius},{lat},{lon});
        );
        out center 10;
        """
        resp = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={'data': query},
            timeout=12
        )
        resp.raise_for_status()
        osm_data = resp.json()

        hospitals = []
        for element in osm_data.get('elements', [])[:8]:
            h_lat = element.get('lat') or element.get('center', {}).get('lat')
            h_lon = element.get('lon') or element.get('center', {}).get('lon')
            if h_lat and h_lon:
                hospitals.append({
                    'name': element.get('tags', {}).get('name', 'Hospital'),
                    'lat': h_lat,
                    'lon': h_lon,
                    'distance_km': round(haversine_distance(lat, lon, h_lat, h_lon), 2),
                    'phone': element.get('tags', {}).get('phone', 'N/A')
                })

        hospitals.sort(key=lambda x: x['distance_km'])
        return jsonify({'hospitals': hospitals})

    except Exception as e:
        return jsonify({'hospitals': [], 'error': str(e)}), 500


@app.route('/api/save-route', methods=['POST'])
@login_required
def save_route():
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Invalid request'}), 400

    try:
        route = SavedRoute(
            user_id=session['user_id'],
            source=data.get('source', ''),
            destination=data.get('destination', ''),
            route_data=json.dumps(data.get('route_data', {})),
            avg_aqi=data.get('avg_aqi'),
            distance=data.get('distance'),
            nickname=data.get('nickname', '')
        )
        db.session.add(route)
        db.session.commit()
        return jsonify({'success': True, 'id': route.id})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Could not save route'}), 500


@app.route('/api/saved-routes')
@login_required
def get_saved_routes():
    routes = (SavedRoute.query
              .filter_by(user_id=session['user_id'])
              .order_by(SavedRoute.saved_at.desc())
              .all())
    return jsonify({'routes': [
        {
            'id': r.id,
            'source': r.source,
            'destination': r.destination,
            'avg_aqi': r.avg_aqi,
            'distance': r.distance,
            'nickname': r.nickname,
            'saved_at': r.saved_at.strftime('%b %d, %Y')
        }
        for r in routes
    ]})


@app.route('/api/delete-route/<int:route_id>', methods=['DELETE'])
@login_required
def delete_route(route_id):
    route = SavedRoute.query.filter_by(id=route_id, user_id=session['user_id']).first()
    if not route:
        return jsonify({'error': 'Route not found'}), 404
    try:
        db.session.delete(route)
        db.session.commit()
        return jsonify({'success': True})
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Could not delete route'}), 500


@app.route('/api/aqi-heatmap', methods=['POST'])
def aqi_heatmap():
    data = request.get_json() or {}
    bounds = data.get('bounds', {})

    lat_min = bounds.get('south', 8.0)
    lat_max = bounds.get('north', 37.0)
    lon_min = bounds.get('west', 68.0)
    lon_max = bounds.get('east', 97.0)

    lat_step = (lat_max - lat_min) / 12
    lon_step = (lon_max - lon_min) / 12

    heatmap_points = []
    lat = lat_min
    while lat <= lat_max:
        lon = lon_min
        while lon <= lon_max:
            aqi = simulate_aqi_for_coords(round(lat, 2), round(lon, 2))
            heatmap_points.append([round(lat, 3), round(lon, 3), round(aqi / 300, 4)])
            lon += lon_step
        lat += lat_step

    return jsonify({'heatmap': heatmap_points})


@app.route('/api/user/profile')
@login_required
def user_profile():
    user = db.session.get(User, session['user_id'])
    if not user:
        return jsonify({'error': 'User not found'}), 404
    route_count = SavedRoute.query.filter_by(user_id=user.id).count()
    return jsonify({
        'username': user.username,
        'email': user.email,
        'joined': user.created_at.strftime('%B %Y'),
        'saved_routes': route_count
    })


# ============================================================
# INIT & RUN
# ============================================================

with app.app_context():
    db.create_all()
    if not User.query.filter_by(email='demo@vayupath.com').first():
        try:
            demo = User(username='demo_user', email='demo@vayupath.com')
            demo.set_password('demo123')
            db.session.add(demo)
            db.session.commit()
        except Exception:
            db.session.rollback()

# ============================================================
# INIT & RUN
# ============================================================

# 1. This runs EVERY time, whether on your Mac or on Render
# ============================================================
# INIT & RUN
# ============================================================

# 1. This runs EVERY time, whether on your Mac or on Render
with app.app_context():
    db.create_all()
    print("Database checked/created successfully!")

# 2. This ONLY runs on your Mac, Render/Gunicorn ignores it
if __name__ == '__main__':
    print("=" * 50)
    print("  VayuPath - AQI Smart Route Optimizer")
    print("  Running at http://localhost:5001")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=5001)
