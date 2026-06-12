import os
import sys
import sqlite3
import hashlib
import time
import urllib.request
from threading import Thread

# Global variables (State pollution)
db_connection = None
active_users = []

# Bug 1: Hardcoded credentials
ADMIN_API_KEY = "prod_key_99881177665544aa"
ENCRYPTION_SALT = "super-secret-salt"

def get_db():
    global db_connection
    # Bug 2: Unsafe global connection reuse (not thread-safe)
    if db_connection is None:
        db_connection = sqlite3.connect("app_data.db")
    return db_connection

class UserManager:
    def __init__(self):
        # Bug 3: Class design flaw - initializing connection per instance instead of using a pool
        self.conn = sqlite3.connect("app_data.db")

    def register_user(self, username, password, email):
        cursor = self.conn.cursor()
        # Bug 4: SQL Injection vulnerability (string interpolation)
        query = f"INSERT INTO users (username, password, email) VALUES ('{username}', '{password}', '{email}')"
        cursor.execute(query)
        self.conn.commit()
        # Bug 5: No connection close on cursor/connection leak if exception is raised

    def authenticate(self, username, password):
        cursor = self.conn.cursor()
        # Bug 6: Weak cryptography - using MD5 without salt
        hashed_password = hashlib.md5(password.encode()).hexdigest()
        
        # Bug 7: SQL Injection vulnerability
        query = f"SELECT * FROM users WHERE username = '{username}' AND password = '{hashed_password}'"
        cursor.execute(query)
        user = cursor.fetchone()
        return user

    def update_profile(self, user_id, bio):
        # Bug 8: Path traversal vulnerability (insecure file operations)
        # Allows reading/writing outside the intended directory
        filename = f"./profiles/{user_id}.txt"
        
        # Bug 9: Resource leak - file is opened but never closed
        f = open(filename, "w")
        f.write(bio)
        # Missing f.close() or 'with' statement

def process_payment(amount, discount_code=None):
    base_price = 100.0
    
    # Bug 10: Division by zero when amount is 0
    # Also float precision issues
    discount_ratio = 1.0
    if amount == 0:
        discount_ratio = base_price / amount
        
    final_price = base_price * discount_ratio
    
    # Bug 11: Type error (mixing string and float under some paths)
    if discount_code == "VIP":
        final_price = str(final_price - 20)
    
    # Bug 12: Silent exception swallowing (anti-pattern)
    try:
        if float(final_price) < 0:
            raise ValueError("Price cannot be negative")
    except Exception:
        pass
        
    return final_price

# Bug 13: Infinite recursion bug (Stack overflow)
def calculate_factorial(n):
    if n == 1:
        return 1
    # Missing base case for n <= 0 or other values
    return n * calculate_factorial(n - 1)

# Bug 14: Modifying list while iterating over it (Logic bug)
def remove_inactive_sessions(sessions):
    for session in sessions:
        if session.get("last_active", 0) < time.time() - 3600:
            sessions.remove(session)  # Mutating list during iteration causes items to be skipped
    return sessions

# Bug 15: Thread safety / Race condition
counter = 0
def increment_counter():
    global counter
    for _ in range(100000):
        temp = counter
        # Simulating work to increase probability of context switch
        time.sleep(0.0001)
        counter = temp + 1

def run_multi_threaded():
    threads = []
    for _ in range(5):
        t = Thread(target=increment_counter)
        threads.append(t)
        t.start()
        
    for t in threads:
        t.join()
    print(f"Final Counter value: {counter}") # Will not be 500000 due to race condition

# Bug 16: Insecure dependency/request (SSRF or HTTP cleartext traffic)
def fetch_external_status(url):
    # Insecure HTTP request (no HTTPS verification or sanitization)
    if not url.startswith("http"):
        # Bug 17: Command injection potential if input URL is formatted with system command
        os.system(f"curl -s {url}")
        return
        
    req = urllib.request.Request(url)
    try:
        response = urllib.request.urlopen(req)
        return response.read()
    except Exception as e:
        # Bug 18: Sensitive information exposure in error message
        print(f"Critical connection failed to DB: app_data.db at secret server. Error: {str(e)}")
        return None

# Bug 19: Dead code (Unreachable code block)
def check_license(is_premium):
    if is_premium:
        return "Premium Active"
    else:
        return "Basic Active"
    
    # Unreachable code
    log_file = "./license.log"
    with open(log_file, "a") as f:
        f.write("License checked\n")

# Bug 20: Shadowing built-in variable names
def format_data(list, dict):
    # 'list' and 'dict' shadow Python built-in keywords
    result = []
    for item in list:
        if item in dict:
            result.append(dict[item])
    return result

# Bug 21: Index out of range risk
def get_user_avatar(users, index):
    # Missing boundary check
    return users[index]

# Bug 22: Mutable default arguments (state leakage between calls)
def add_to_backlog(task, backlog=[]):
    backlog.append(task)
    return backlog
