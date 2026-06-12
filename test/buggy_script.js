// Bug 1: Hardcoded AWS Credentials
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

// Bug 2: Global namespace pollution
var currentUser = {};

function processUserData(userId, callback) {
    // Bug 3: Strict equality check missing (loose comparison)
    if (userId == "admin") {
        currentUser.role = "administrator";
    }

    // Bug 4: Callback hell / Pyramids of doom
    fetchUserFromDB(userId, function(err, user) {
        if (err) {
            console.log("Error: " + err); // Bug 5: Inadequate logging/sensitive info leak
            callback(err);
        } else {
            fetchUserPermissions(user.id, function(err, perms) {
                if (err) {
                    callback(err);
                } else {
                    fetchUserPreferences(user.id, function(err, prefs) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, { user, perms, prefs });
                        }
                    });
                }
            });
        }
    });
}

// Bug 6: DOM-based XSS (Insecure HTML insertion)
function updateUIWithSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q');
    
    // Insecure: inserting user input directly into innerHTML
    document.getElementById('search-results').innerHTML = "You searched for: " + query;
}

// Bug 7: Infinite Loop under negative inputs
function findFactorialJS(n) {
    let result = 1;
    let i = n;
    while (i > 0) {
        result *= i;
        i--;
        // If n is negative or non-integer, this loop can run forever or behave unexpectedly
    }
    return result;
}

// Bug 8: Unhandled promise rejection & silent failure
function fetchDataAsync(url) {
    // Missing return statement, no catch block for errors
    fetch(url)
        .then(response => response.json())
        .then(data => {
            console.log("Data loaded:", data);
        });
        // Unhandled rejection if network request fails
}

// Bug 9: ReferenceError (using variable before declaration / hoisting)
function checkSystemStatus() {
    statusMessage = "System is running"; // Missing let/const/var declaration (accidental global)
    console.log(msg); // ReferenceError: msg is not defined
    var msg = "Status check complete"; 
}

// Mock functions for callback demo
function fetchUserFromDB(id, cb) { cb(null, { id: id, name: "Test User" }); }
function fetchUserPermissions(id, cb) { cb(null, ["read", "write"]); }
function fetchUserPreferences(id, cb) { cb(null, { theme: "dark" }); }
