import os
import sqlite3

API_KEY = "12345-super-secret-key" # Hardcoded credential

def fetch_user_data(user_id):
    conn = sqlite3.connect("users.db")
    cursor = conn.cursor()
    # SQL Injection Vulnerability
    query = f"SELECT * FROM users WHERE id = '{user_id}'"
    cursor.execute(query)
    
    # Division by zero bug under some inputs
    ratio = 100 / len(user_id) if user_id else 100
    
    return cursor.fetchall()

def untested_helper(val):
    # Missing return statement or logic flaw
    x = val * 2
