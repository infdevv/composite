import json

def reset_balances():
    file_path = 'data/users.json'
    try:
        with open(file_path, 'r') as file:
            users = json.load(file)
        
        # Assuming users is a dictionary where keys are user IDs and values are user data dicts with 'balance'
        for user_id, user_data in users.items():
            if isinstance(user_data, dict) and 'balance' in user_data:
                user_data['balance'] = 0
        
        with open(file_path, 'w') as file:
            json.dump(users, file, indent=4)
        
        print("All balances have been reset to zero.")
    except FileNotFoundError:
        print(f"File not found: {file_path}")
    except json.JSONDecodeError:
        print("Error decoding JSON. Please check the file format.")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    reset_balances()