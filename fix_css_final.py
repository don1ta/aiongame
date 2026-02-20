import sys

file_path = r'c:\Users\zxc15\Documents\GitHub\aiongame\css\aion.css'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Check if the last line is just a brace with potential whitespace
if lines and lines[-1].strip() == '}':
    # Check if the line before it or the structure suggests it's redundant
    # In our case, we know it is.
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(lines[:-1])
    print("Successfully removed redundant brace.")
else:
    print("Last line was not a standalone brace or file is empty.")
