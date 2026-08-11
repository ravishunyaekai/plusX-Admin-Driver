import express from 'express';
import bodyParser from 'body-parser';
import adminRoutes from './routes/admin.js';
import driverRoutes from './routes/driver.js';
import communityRoutes from './routes/community.js';
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
        'http://localhost:1117'
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

// ---------------------------------------------------------------------------
// Community panel UI (separate React project build → upload to community-build/)
// Accessible at: https://plusx.shunyaekai.com/community-app
// Community React app must be built with base path "/community-app"
// ---------------------------------------------------------------------------
// app.use('/community-app', express.static(path.join(__dirname, 'community-build')));
// app.get('/community-app/*', function (req, res) {
//     res.sendFile(path.join(__dirname, 'community-build', 'index.html'));
// });
app.use('/community-app', express.static(path.join(__dirname, 'community-build', 'build')));
app.get('/community-app/*', function (req, res) {
    res.sendFile(path.join(__dirname, 'community-build', 'build', 'index.html'));
});

// ---------------------------------------------------------------------------
// Admin panel UI (existing React build → upload to build/)
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
