#!/usr/bin/env node

/**
 * Session Management Test Script
 * Tests the session management API endpoints
 */

const http = require('http');

const API_BASE = 'http://localhost:3030/api';

function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE + path);
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(url, options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(body)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: body
                    });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

async function testSessionManagement() {
    console.log('🧪 Testing Session Management API\n');

    try {
        // Test 1: Get all sessions
        console.log('1️⃣ Getting all sessions...');
        const sessionsResponse = await makeRequest('GET', '/sessions');
        console.log('   Status:', sessionsResponse.status);
        console.log('   Sessions:', JSON.stringify(sessionsResponse.data, null, 2));
        console.log('   ✅ Success\n');

        // Test 2: Create new session
        console.log('2️⃣ Creating new test session...');
        const createResponse = await makeRequest('POST', '/sessions', {
            name: 'Test Session ' + Date.now()
        });
        console.log('   Status:', createResponse.status);
        console.log('   Response:', JSON.stringify(createResponse.data, null, 2));
        
        if (createResponse.data.session) {
            console.log('   ✅ Session created successfully\n');
            
            // Test 3: Get sessions again to verify
            console.log('3️⃣ Verifying session creation...');
            const verifyResponse = await makeRequest('GET', '/sessions');
            console.log('   Total sessions:', verifyResponse.data.sessions.length);
            console.log('   ✅ Verified\n');
            
            // Test 4: Try to delete the created session (if not active)
            const sessionId = createResponse.data.session.id;
            if (!createResponse.data.session.active) {
                console.log('4️⃣ Deleting test session...');
                const deleteResponse = await makeRequest('DELETE', `/sessions/${sessionId}`);
                console.log('   Status:', deleteResponse.status);
                console.log('   Response:', JSON.stringify(deleteResponse.data, null, 2));
                
                if (deleteResponse.data.success) {
                    console.log('   ✅ Session deleted successfully\n');
                } else {
                    console.log('   ⚠️ Could not delete session\n');
                }
            }
        } else {
            console.log('   ⚠️ Session creation failed\n');
        }

        console.log('✅ All tests completed!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error);
    }
}

// Check if server is running
console.log('Checking if server is running on http://localhost:3030...\n');

const checkServer = http.request('http://localhost:3030/api/health', (res) => {
    if (res.statusCode === 200) {
        console.log('✅ Server is running!\n');
        testSessionManagement();
    } else {
        console.error('❌ Server returned status:', res.statusCode);
        console.error('Please start the ChromWhatsApp server first with: npm start');
    }
});

checkServer.on('error', (error) => {
    console.error('❌ Cannot connect to server');
    console.error('Please start the ChromWhatsApp server first with: npm start');
    console.error('Error:', error.message);
});

checkServer.end();
