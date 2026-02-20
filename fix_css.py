import os

file_path = r'c:\Users\zxc15\Documents\GitHub\aiongame\css\aion.css'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Look for the last media query close
# We know it's around the end
new_lines = []
for line in lines:
    new_lines.append(line)
    if '.profile-meta-grid {' in line:
        pass

# Actually, let's just rewrite the end strictly
# Find where .profile-meta-grid ends
found_idx = -1
for i in range(len(lines)-1, -1, -1):
    if 'justify-content: center;' in lines[i]:
        found_idx = i
        break

if found_idx != -1:
    # Keep up to the closing brace of the media query
    # The structure was:
    # 2601:             .profile-meta-grid {
    # 2602:                 justify-content: center;
    # 2603:             }
    # 2604:         }
    
    final_lines = lines[:found_idx+3] # Keep through 2603
    
    # Check if lines[found_idx+2] is indeed the closing brace for meta-grid
    # and lines[found_idx+3] is the closing brace for media query
    
    # New styles
    style = """
        /* 🛡️ 增益效果控制項置頂固定樣式 */
        #gain-effect-controls {
            position: sticky;
            top: 10px;
            z-index: 1000;
            background: rgba(21, 27, 38, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
           
            margin-bottom: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 15px rgba(0, 212, 255, 0.1);
            transition: all 0.3s ease;
            border-top: 2px solid var(--gold);
        }

        #gain-effect-controls:hover {
            border-color: var(--gold);
            background: rgba(21, 27, 38, 0.98);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(255, 217, 61, 0.15);
        }
"""
    # Write back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(final_lines)
        f.write(style)
    print("Fixed CSS file.")
else:
    print("Could not find anchor in CSS file.")
