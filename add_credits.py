import sys 
# utf 8
sys.stdout.reconfigure(encoding='utf-8')
import json
import os

def add_credits_to_users(file_path, credits_to_add=6000):
    """
    Add specified credits to all users in the users.json file
    
    Args:
        file_path (str): Path to the users.json file
        credits_to_add (int): Number of credits to add to each user
    """
    
    # Check if file exists
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} does not exist!")
        return False
    
    try:
        # Read the JSON file
        with open(file_path, 'r', encoding='utf-8') as file:
            users_data = json.load(file)
        
        print(f"Loaded {len(users_data)} users from {file_path}")
        
        # Add credits to each user
        for user_id, user_data in users_data.items():
            current_balance = user_data.get('balance', 0)
            new_balance = current_balance + credits_to_add
            user_data['balance'] = new_balance
            print(f"User {user_id}: {current_balance} → {new_balance} credits")
        
        # Write the updated data back to the file
        with open(file_path, 'w', encoding='utf-8') as file:
            json.dump(users_data, file, indent=2)
        
        print(f"\nSuccessfully added {credits_to_add} credits to all {len(users_data)} users!")
        print(f"Updated data saved to {file_path}")
        
        return True
        
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format in {file_path}: {e}")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    """Main function"""
    
    # Path to the users.json file
    file_path = "data/users.json"
    
    print("=== Credit Addition Script ===")
    print(f"Adding credits to each user in {file_path}")
    print()
    
    # Add 100 billion credits to all users
    success = add_credits_to_users(file_path, 100000000000)
    
    if success:
        print("\nScript completed successfully!")
    else:
        print("\nScript failed!")

if __name__ == "__main__":
    main()