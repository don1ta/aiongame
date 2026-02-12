const fs = require('fs');
const path = 'd:/c150075/Desktop/aiongame/aion.html';

try {
    // 讀取檔案為 Buffer (二進制)
    const buffer = fs.readFileSync(path);

    // 尋找 </html> 的結尾 (Hex: 3C 2F 68 74 6D 6C 3E)
    // 我們搜尋最後一次出現的位置
    const closingTag = Buffer.from('</html>');
    const lastIndex = buffer.lastIndexOf(closingTag);

    if (lastIndex !== -1) {
        // 計算截斷位置：</html> 的開始位置 + 長度
        const truncateAt = lastIndex + closingTag.length;

        console.log(`Found </html> at offset ${lastIndex}. Truncating file to ${truncateAt} bytes.`);

        // 建立新的 Buffer，只包含有效內容
        const newBuffer = Buffer.alloc(truncateAt + 60); // 預留空間給新 script
        buffer.copy(newBuffer, 0, 0, truncateAt);

        // 加入 <script src="health_check.js"></script>
        const scriptTag = Buffer.from('\n<script src="health_check.js"></script>');
        scriptTag.copy(newBuffer, truncateAt);

        // 寫回檔案 (只寫入實際使用的長度)
        const finalBuffer = newBuffer.slice(0, truncateAt + scriptTag.length);
        fs.writeFileSync(path, finalBuffer);

        console.log('File repaired and script tag appended successfully.');
    } else {
        console.log('Could not find </html> tag. Appending script tag to the end anyway.');
        // 如果找不到，直接附加 (可能是因為檔案結構不同)
        const scriptContent = '\n<script src="health_check.js"></script>';
        fs.appendFileSync(path, scriptContent);
    }
} catch (err) {
    console.error('Error repairing file:', err);
}
