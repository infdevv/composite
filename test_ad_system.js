#!/usr/bin/env node

// Simple test script to verify the ad system works
const fetch = require('node-fetch');

async function testAdSystem() {
    console.log('Testing simplified ad system...');
    
    const serverUrl = 'http://localhost:3000';
    
    // Test 1: Generate API key
    console.log('\n1. Testing API key generation...');
    try {
        const keyResponse = await fetch(`${serverUrl}/api/make-key`);
        const keyData = await keyResponse.json();
        console.log('✓ API key generated:', keyData.key);
        
        // Test 2: Get ad URL
        console.log('\n2. Testing ad URL generation...');
        const adResponse = await fetch(`${serverUrl}/api/getAdUrl`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: serverUrl + '/rep.html',
                key: keyData.key
            })
        });
        const adData = await adResponse.json();
        
        if (adData.adUrl) {
            console.log('✓ Ad URL generated:', adData.adUrl.substring(0, 100) + '...');
        } else {
            console.log('✗ Failed to get ad URL:', adData);
        }
        
        // Test 3: Get credits (should work if 12+ hours since last ad)
        console.log('\n3. Testing credit collection...');
        const creditsResponse = await fetch(`${serverUrl}/api/getCredits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: keyData.key
            })
        });
        const creditsData = await creditsResponse.json();
        
        if (creditsResponse.ok) {
            console.log('✓ Credits awarded:', creditsData.creditAmount);
            console.log('✓ New balance:', creditsData.balance);
        } else {
            console.log('ℹ Expected wait time error:', creditsData.error);
        }
        
    } catch (error) {
        console.log('✗ Test failed:', error.message);
        console.log('Make sure the server is running: node index.js');
    }
}

testAdSystem();