import sys

file_path = r'c:\Users\zxc15\Documents\GitHub\aiongame\css\aion.css'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

# Remove the very last closing brace if it's redundant
# The end of the file currently is:
#         }
#         }
# Let's count the braces or just look at the last few lines.

lines = text.splitlines()
if lines and lines[-1].strip() == '}':
    # Remove one closing brace
    new_text = "\n".join(lines[:-1])
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("Fixed CSS syntax (removed trailing brace).")
else:
    print("No trailing brace found or file empty.")
