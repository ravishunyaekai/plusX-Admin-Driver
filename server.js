import express from 'express';
import bodyParser from 'body-parser';
import adminRoutes from './routes/admin.js';
import driverRoutes from './routes/driver.js';
import communityRoutes from './routes/community.js';
import partnerStationRoutes from './routes/partnerStation.js';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { errorHandler } from './middleware/errorHandler.js';
import dotenv from 'dotenv';
dotenv.config();

const app  = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3333;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const corsOptions = {
    origin : [
        'https://backend.plusxelectric.com',
        'http://localhost:1116',
        'http://192.168.1.23:1116',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8802',
        'http://localhost:1117',
        'https://partners.shunyaekai.com',
        'https://partners.plusxelectric.com',
        'https://csms.shunyaekai.com',
        'https://csms.plusxelectric.com',
        'http://localhost:2425'
    ],
    // origin : "*",
    methods: 'GET, POST, PUT, DELETE',
    credentials: true
};

app.use(cors(corsOptions));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(bodyParser.json());
app.use(cookieParser());

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// API routes
app.use('/admin', adminRoutes);
app.use('/driver', driverRoutes);
// Community manager APIs (login, dashboard, community details, residents — scoped by community_id)
app.use('/community', communityRoutes);
// Station Master portal APIs (credentials on partner_charging_stations.master_*)
app.use('/partner', partnerStationRoutes);

// ---------------------------------------------------------------------------
// Frontend build folders (each is a separate React project output on disk):
//   build/          — Admin panel (PlusX-React-Admin)
//   partner-build/  — Community panel (PlusX-React-Community)
//   csms-build/build/ — Partner station portal (plusx-partner-panel)
// Nginx: proxy_set_header Host $host; so req.hostname routing works.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Community panel UI on partner subdomain (served at root "/")
// Testing : https://partners.shunyaekai.com
// Live    : https://partners.plusxelectric.com
// Community React app must be built with base path "/"
// Nginx must forward the original host: proxy_set_header Host $host;
// ---------------------------------------------------------------------------
const COMMUNITY_HOSTS = ['partners.shunyaekai.com', 'partners.plusxelectric.com'];
const communityStatic = express.static(path.join(__dirname, 'partner-build', 'build'));
const communityIndex  = path.join(__dirname, 'partner-build', 'build', 'index.html');

app.use((req, res, next) => {
    if (COMMUNITY_HOSTS.includes(req.hostname)) {
        return communityStatic(req, res, () => res.sendFile(communityIndex));
    }
    next();
});

// ---------------------------------------------------------------------------
// Partner station portal (csms-build/) on csms subdomain (served at root "/")
// Testing : https://csms.shunyaekai.com
// Live    : https://csms.plusxelectric.com
// plusx-partner-panel: homepage "/", basename from PUBLIC_URL (same pattern as partners)
// Copy build/ → csms-build/build/
// APIs on same host: /partner/*
// Nginx must forward the original host: proxy_set_header Host $host;
// ---------------------------------------------------------------------------
const CSMS_HOSTS = ['csms.shunyaekai.com', 'csms.plusxelectric.com'];
const csmsStatic = express.static(path.join(__dirname, 'csms-build', 'build'));
const csmsIndex  = path.join(__dirname, 'csms-build', 'build', 'index.html');

app.use((req, res, next) => {
    if (CSMS_HOSTS.includes(req.hostname)) {
        return csmsStatic(req, res, () => res.sendFile(csmsIndex));
    }
    next();
});

// ---------------------------------------------------------------------------
// Community panel (partner-build/) — alternate path on admin host
// Accessible at: https://plusx.shunyaekai.com/community-app
// Community React app must be built with base path "/community-app"
// ---------------------------------------------------------------------------
// app.use('/community-app', express.static(path.join(__dirname, 'partner-build')));
// app.get('/community-app/*', function (req, res) {
//     res.sendFile(path.join(__dirname, 'partner-build', 'index.html'));
// });
app.use('/community-app', express.static(path.join(__dirname, 'partner-build', 'build')));
app.get('/community-app/*', function (req, res) {
    res.sendFile(path.join(__dirname, 'partner-build', 'build', 'index.html'));
});

// ---------------------------------------------------------------------------
// Partner station / CSMS (csms-build/) — alternate path on admin host
// e.g. https://plusx.shunyaekai.com/csms-app
// Optional: npm run build:csms-app in plusx-partner-panel (PUBLIC_URL=/csms-app)
// csms.* subdomain uses default npm run build (homepage "/") — see CSMS_HOSTS block above.
// ---------------------------------------------------------------------------
app.use('/csms-app', express.static(path.join(__dirname, 'csms-build', 'build')));
app.get('/csms-app/*', function (req, res) {
    res.sendFile(path.join(__dirname, 'csms-build', 'build', 'index.html'));
});

// ---------------------------------------------------------------------------
// Admin panel (build/) — default host (e.g. plusx.shunyaekai.com)
// Keep this last so it does not catch /community-app or API routes
// Accessible at: https://plusx.shunyaekai.com/
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'build')));
app.get('/*', function (req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Live Update - 18-11-2026   - https://docs.google.com/document/d/1mOJFHh9R5np30pRuCyMQnaelB5eNBSwUaJowmIGJ8dw/edit?tab=t.0
