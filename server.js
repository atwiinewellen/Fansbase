const express = require('express');
const { google } = require('googleapis');
const Paystack = require('paystack')('sk_test_3b68488b2d8cf181aa072c760c12037a44667d');
const { MongoClient, ServerApiVersion } = require('mongodb'); // Add ServerApiVersion
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

// MongoDB Atlas connection
const uri = 'mongodb+srv://Fansbase:<3zBDvMIYHTRW70FS>@cluster0.n0zcd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'; // Replace with your actual string
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
let db;

async function connectToMongo() {
    try {
        // Connect the client to the server
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
        // Set the database reference
        db = client.db('creator_platform');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error; // Throw error to prevent server from starting if connection fails
    }
    // Note: We do NOT close the client here because the Express server needs it open
}

// Call the connection function and handle errors
connectToMongo().catch(error => {
    console.error('Failed to connect to MongoDB. Server will not start:', error);
    process.exit(1); // Exit the process if connection fails
});

const youtube = google.youtube({
    version: 'v3',
    auth: 'AIZaSyA2YVSvgFA - h9wViWVejmiNMAFFxpS9Q4r0'
});

async function checkCreator(channelId) {
    if (!channelId || !channelId.match(/^UC[a-zA-Z0-9_-]+$/)) {
        throw new Error('Invalid YouTube Channel ID format.');
    }

    try {
        const res = await youtube.channels.list({
            part: 'statistics',
            id: channelId
        });

        if (!res.data.items || res.data.items.length === 0) {
            throw new Error('Channel not found.');
        }

        const subs = res.data.items[0].statistics.subscriberCount;
        console.log(`Subscribers: ${subs}`);
        return { eligible: subs > 500, subscribers: parseInt(subs) };
    } catch (error) {
        console.log('Error:', error.message);
        throw error;
    }
}

async function processPayment(amount, creatorId) {
    try {
        const response = await Paystack.transaction.initialize({
            email: 'customer@example.com',
            amount: amount * 100,
            currency: 'KES',
            reference: `tx-${Date.now()}`,
            callback_url: 'https://yourdomain.com/redirect'
        });
        console.log('Payment Response:', response);
        if (response.status) {
            return response.data.authorization_url;
        } else {
            console.log('Paystack Error:', response.message);
            throw new Error('Payment initiation failed: ' + response.message);
        }
    } catch (error) {
        console.log('Payment error:', error.message);
        throw error;
    }
}

// JWT middleware to protect routes
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied' });

    try {
        const verified = jwt.verify(token, 'your_jwt_secret');
        req.user = verified;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
}

// Register a new creator
app.post('/register', async(req, res) => {
    const { email, password, channelId } = req.body;
    if (!email || !password || !channelId) {
        return res.status(400).json({ error: 'Email, password, and channel ID are required' });
    }

    try {
        const creatorsCollection = db.collection('creators');
        const existingCreator = await creatorsCollection.findOne({ email });
        if (existingCreator) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const creator = { email, password: hashedPassword, channelId };
        await creatorsCollection.insertOne(creator);

        res.status(201).json({ success: true, message: 'Creator registered' });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Creator login
app.post('/login', async(req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const creatorsCollection = db.collection('creators');
        const creator = await creatorsCollection.findOne({ email });
        if (!creator) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, creator.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: creator._id, email: creator.email }, 'your_jwt_secret', { expiresIn: '1h' });
        res.json({ success: true, token, channelId: creator.channelId });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/check-creator/:channelId', async(req, res) => {
    const channelId = req.params.channelId;
    try {
        const result = await checkCreator(channelId);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Gracefully close the MongoDB client on server shutdown
process.on('SIGINT', async() => {
    console.log('Closing MongoDB client...');
    await client.close();
    process.exit(0);
});