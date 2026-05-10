 (function() {
        // ================ ENHANCED CALCULATOR ENGINE ================
        
        // DOM Elements - Using unique prefixes to avoid conflicts with Blogger
        const expressionDiv = document.getElementById('calcExpressionDisplay');
        const resultDiv = document.getElementById('calcResultDisplay');
        const basicModeDiv = document.getElementById('calcBasicMode');
        const scientificModeDiv = document.getElementById('calcScientificMode');
        const basicModeBtn = document.getElementById('calcBasicModeBtn');
        const scientificModeBtn = document.getElementById('calcScientificModeBtn');
        const angleToggle = document.getElementById('calcAngleToggle');
        const angleIndicator = document.getElementById('calcAngleIndicator');
        const memoryIndicator = document.getElementById('calcMemoryIndicator');
        
        // Calculator State
        let currentExpression = "0";
        let lastResult = null;
        let waitingForOperand = false;
        let lastOperator = null;
        let angleMode = 'deg'; // 'deg', 'rad', 'grad'
        let memory = 0;
        let hasMemory = false;
        let lastAnswer = null;
        let history = [];
        
        // ================ ANGLE CONVERSION ================
        function toRadians(value) {
            if (angleMode === 'deg') return value * Math.PI / 180;
            if (angleMode === 'grad') return value * Math.PI / 200;
            return value;
        }
        
        function fromRadians(value) {
            if (angleMode === 'deg') return value * 180 / Math.PI;
            if (angleMode === 'grad') return value * 200 / Math.PI;
            return value;
        }
        
        // ================ EXPRESSION PARSER ================
        function evaluate(expr) {
            try {
                // Replace display operators with computation operators
                let processed = expr
                    .replace(/×/g, '*')
                    .replace(/÷/g, '/')
                    .replace(/−/g, '-');
                
                // Replace constants
                processed = processed.replace(/π/g, `(${Math.PI})`);
                processed = processed.replace(/(?<![a-zA-Z0-9.])e(?![a-zA-Z0-9+])/g, `(${Math.E})`);
                
                // Handle postfix operators (², ³, !)
                processed = processed.replace(/([0-9.]+|[)])²/g, 'Math.pow($1,2)');
                processed = processed.replace(/([0-9.]+|[)])³/g, 'Math.pow($1,3)');
                processed = processed.replace(/(\d+)!/g, function(_, num) {
                    const n = parseInt(num);
                    if (n < 0 || n > 170) throw new Error('Invalid factorial');
                    if (n === 0 || n === 1) return '1';
                    let result = 1;
                    for (let i = 2; i <= n; i++) result *= i;
                    return result.toString();
                });
                
                // Handle functions with unique variable names to avoid conflicts
                const functionMap = {
                    'sin': function(x) { return Math.sin(toRadians(x)); },
                    'cos': function(x) { return Math.cos(toRadians(x)); },
                    'tan': function(x) {
                        const rad = toRadians(x);
                        const cosVal = Math.cos(rad);
                        if (Math.abs(cosVal) < 1e-10) throw new Error('Undefined');
                        return Math.tan(rad);
                    },
                    'sin⁻¹': function(x) { return fromRadians(Math.asin(x)); },
                    'cos⁻¹': function(x) { return fromRadians(Math.acos(x)); },
                    'tan⁻¹': function(x) { return fromRadians(Math.atan(x)); },
                    'ln': function(x) {
                        if (x <= 0) throw new Error('Invalid input');
                        return Math.log(x);
                    },
                    'log₁₀': function(x) {
                        if (x <= 0) throw new Error('Invalid input');
                        return Math.log10(x);
                    },
                    '√': function(x) {
                        if (x < 0) throw new Error('Invalid input');
                        return Math.sqrt(x);
                    },
                    '∛': function(x) { return Math.cbrt(x); },
                    'eˣ': function(x) { return Math.exp(x); },
                    '10ˣ': function(x) { return Math.pow(10, x); }
                };
                
                // Replace functions with their JavaScript equivalents
                for (const [funcName, funcImpl] of Object.entries(functionMap)) {
                    const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(escapedName + '\\(', 'g');
                    const funcVarName = '__calcFunc_' + funcName.replace(/[^a-zA-Z0-9]/g, '_');
                    
                    if (processed.includes(funcName + '(')) {
                        window[funcVarName] = funcImpl;
                        processed = processed.replace(regex, funcVarName + '(');
                    }
                }
                
                // Handle power operator
                processed = processed.replace(/\^/g, '**');
                
                // Handle reciprocal
                processed = processed.replace(/1\/x\(([^)]+)\)/g, '(1/($1))');
                
                // Check for potentially unsafe content
                if (/[^0-9+\-*/().,% Math\.\w_]/g.test(processed.replace(/\s/g, ''))) {
                    throw new Error('Invalid characters');
                }
                
                // Evaluate using Function constructor for safety
                const result = new Function('"use strict"; return (' + processed + ')')();
                
                // Clean up function variables
                for (const funcName of Object.keys(functionMap)) {
                    const funcVarName = '__calcFunc_' + funcName.replace(/[^a-zA-Z0-9]/g, '_');
                    delete window[funcVarName];
                }
                
                if (typeof result !== 'number' || !isFinite(result)) {
                    throw new Error('Invalid result');
                }
                
                return parseFloat(result.toFixed(10));
            } catch (e) {
                console.error('Evaluation error:', e.message);
                return null;
            }
        }
        
        // ================ DISPLAY ================
        function formatNumber(num) {
            if (num === null || num === undefined) return "0";
            if (!isFinite(num)) return "Error";
            
            // Handle very large or very small numbers
            if (Math.abs(num) > 1e12 || (Math.abs(num) < 1e-9 && num !== 0)) {
                return num.toExponential(8);
            }
            
            // Remove floating point imprecision
            let str = parseFloat(num.toPrecision(12)).toString();
            
            // Limit length
            if (str.length > 15) {
                str = parseFloat(num.toPrecision(10)).toString();
            }
            
            return str;
        }
        
        function updateDisplay() {
            let expr = currentExpression || "0";
            if (expr === "") expr = "0";
            expressionDiv.innerText = expr;
            
            if (expr.length > 30) {
                expressionDiv.classList.add('has-content');
            } else {
                expressionDiv.classList.remove('has-content');
            }
            
            // Auto-evaluate if possible
            if (!waitingForOperand && expr !== "0" && expr !== "Error") {
                const lastChar = expr[expr.length - 1];
                const isIncomplete = /[+\-*/×÷^(]$/.test(expr) || 
                                    (expr.split('(').length !== expr.split(')').length);
                
                if (!isIncomplete) {
                    let evaluated = evaluate(expr);
                    if (evaluated !== null) {
                        resultDiv.innerText = formatNumber(evaluated);
                        lastAnswer = evaluated;
                        updateMemoryIndicator();
                        return;
                    }
                }
            }
            
            // Fallback result display
            if (waitingForOperand && lastResult !== null) {
                resultDiv.innerText = formatNumber(lastResult);
            } else if (expr === "Error") {
                resultDiv.innerText = "Error";
            } else {
                resultDiv.innerText = "0";
            }
            
            updateMemoryIndicator();
        }
        
        function updateMemoryIndicator() {
            if (hasMemory) {
                memoryIndicator.classList.add('active');
            } else {
                memoryIndicator.classList.remove('active');
            }
        }
        
        // ================ INPUT HANDLING ================
        function isValidInput(value) {
            if (currentExpression === "Error") return true;
            
            // Prevent multiple decimals in the last number
            if (value === '.') {
                const parts = currentExpression.split(/[+\-*/×÷^(]/);
                const lastPart = parts[parts.length - 1];
                if (lastPart.includes('.')) return false;
            }
            
            // Prevent multiple operators
            if (['+', '-', '*', '/', '×', '÷', '^'].includes(value)) {
                const lastChar = currentExpression[currentExpression.length - 1];
                if (['+', '-', '*', '/', '×', '÷', '^', '('].includes(lastChar)) {
                    if (value === '-' && lastChar !== '-') return true;
                    return false;
                }
            }
            
            return true;
        }
        
        function appendToExpression(value) {
            if (!isValidInput(value)) return;
            
            if (currentExpression === "Error") {
                currentExpression = "";
                waitingForOperand = false;
            }
            
            if (waitingForOperand && !isNaN(value) && value !== '.') {
                currentExpression = value.toString();
                waitingForOperand = false;
                updateDisplay();
                return;
            }
            
            if (waitingForOperand && value === '.') {
                currentExpression = "0.";
                waitingForOperand = false;
                updateDisplay();
                return;
            }
            
            if (waitingForOperand && ['+', '-', '*', '/', '×', '÷', '^'].includes(value)) {
                currentExpression = (lastResult !== null ? lastResult.toString() : "0") + value;
                waitingForOperand = false;
                updateDisplay();
                return;
            }
            
            if (currentExpression === "0" && !isNaN(value) && value !== '.') {
                currentExpression = value.toString();
            } else {
                currentExpression += value;
            }
            
            updateDisplay();
        }
        
        function setOperator(op) {
            if (currentExpression === "Error") return;
            
            let opChar = op;
            if (op === '×') opChar = '×';
            if (op === '÷') opChar = '÷';
            
            if (!isValidInput(opChar)) return;
            
            if (currentExpression === "" || currentExpression === "0") {
                currentExpression = "0" + opChar;
            } else if (/[+\-*/×÷^]$/.test(currentExpression)) {
                currentExpression = currentExpression.slice(0, -1) + opChar;
            } else {
                currentExpression += opChar;
            }
            
            waitingForOperand = false;
            updateDisplay();
        }
        
        function calculateResult() {
            if (currentExpression === "Error" || currentExpression === "") {
                currentExpression = "0";
                updateDisplay();
                return;
            }
            
            let expr = currentExpression;
            if (/[+\-*/×÷^]$/.test(expr)) {
                expr = expr.slice(0, -1);
            }
            
            // Check for unbalanced parentheses
            const openCount = (expr.match(/\(/g) || []).length;
            const closeCount = (expr.match(/\)/g) || []).length;
            if (openCount > closeCount) {
                expr += ')'.repeat(openCount - closeCount);
            }
            
            let result = evaluate(expr);
            
            if (result !== null) {
                history.push({ expression: expr, result: result });
                if (history.length > 50) history.shift();
                
                lastResult = result;
                lastAnswer = result;
                resultDiv.innerText = formatNumber(result);
                currentExpression = result.toString();
                waitingForOperand = true;
            } else {
                resultDiv.innerText = "Error";
                currentExpression = "Error";
                waitingForOperand = true;
            }
            updateDisplay();
        }
        
        function clearAll() {
            currentExpression = "0";
            lastResult = null;
            waitingForOperand = false;
            updateDisplay();
        }
        
        function clearEntry() {
            if (waitingForOperand) {
                currentExpression = "0";
                waitingForOperand = false;
            } else {
                const match = currentExpression.match(/(.*[+\-*/×÷^(])?(\d+\.?\d*)$/);
                if (match) {
                    currentExpression = (match[1] || '') + '0';
                } else {
                    currentExpression = "0";
                }
            }
            updateDisplay();
        }
        
        function backspace() {
            if (currentExpression === "Error") {
                clearAll();
                return;
            }
            if (waitingForOperand) return;
            
            if (currentExpression.length <= 1) {
                currentExpression = "0";
            } else {
                const lastTwo = currentExpression.slice(-2);
                if (lastTwo === '⁻¹' || lastTwo === '₁₀' || lastTwo === 'ˣ(') {
                    currentExpression = currentExpression.slice(0, -2);
                } else if (['×', '÷', '²', '³'].some(function(s) { return lastTwo.includes(s); })) {
                    currentExpression = currentExpression.slice(0, -1);
                } else {
                    currentExpression = currentExpression.slice(0, -1);
                }
                
                if (currentExpression === "" || currentExpression === "-") {
                    currentExpression = "0";
                }
            }
            updateDisplay();
        }
        
        function percent() {
            if (currentExpression === "Error") return;
            
            try {
                let result = evaluate(currentExpression);
                if (result !== null) {
                    currentExpression = (result / 100).toString();
                    updateDisplay();
                }
            } catch(e) {}
        }
        
        function insertScientific(func) {
            if (waitingForOperand) {
                waitingForOperand = false;
            }
            
            const funcMap = {
                'sin': 'sin(', 'cos': 'cos(', 'tan': 'tan(',
                'asin': 'sin⁻¹(', 'acos': 'cos⁻¹(', 'atan': 'tan⁻¹(',
                'ln': 'ln(', 'log': 'log₁₀(', 'sqrt': '√(', 'cbrt': '∛(',
                'square': '²', 'cube': '³', 'power': '^',
                'exp': 'eˣ(', 'tenx': '10ˣ(',
                'recip': '1/x(', 'pi': 'π', 'euler': 'e'
            };
            
            let insertStr = funcMap[func] || func + '(';
            
            if (currentExpression === "0" && insertStr !== '²' && insertStr !== '³') {
                currentExpression = insertStr;
            } else {
                currentExpression += insertStr;
            }
            
            if (func === 'fact') {
                currentExpression += '!';
            }
            
            updateDisplay();
        }
        
        function insertParen(paren) {
            if (waitingForOperand) {
                currentExpression = "0";
                waitingForOperand = false;
            }
            
            if (currentExpression === "0" && paren === '(') {
                currentExpression = "(";
            } else {
                currentExpression += paren;
            }
            
            updateDisplay();
        }
        
        // ================ MEMORY FUNCTIONS ================
        function memoryClear() {
            memory = 0;
            hasMemory = false;
            updateDisplay();
        }
        
        function memoryRecall() {
            if (hasMemory) {
                if (waitingForOperand) {
                    currentExpression = memory.toString();
                    waitingForOperand = false;
                } else {
                    currentExpression += memory.toString();
                }
                updateDisplay();
            }
        }
        
        function memoryAdd() {
            const result = evaluate(currentExpression);
            if (result !== null) {
                memory += result;
                hasMemory = true;
                updateDisplay();
            }
        }
        
        function memorySubtract() {
            const result = evaluate(currentExpression);
            if (result !== null) {
                memory -= result;
                hasMemory = true;
                updateDisplay();
            }
        }
        
        function memoryStore() {
            const result = evaluate(currentExpression);
            if (result !== null) {
                memory = result;
                hasMemory = true;
                updateDisplay();
            }
        }
        
        // ================ ANGLE MODE ================
        function setAngleMode(mode) {
            angleMode = mode;
            
            document.querySelectorAll('.calc-wrapper .angle-btn').forEach(function(btn) {
                btn.classList.remove('active');
                if (btn.dataset.angle === mode) {
                    btn.classList.add('active');
                }
            });
            
            angleIndicator.textContent = mode.toUpperCase();
            angleIndicator.classList.add('visible');
            
            if (scientificModeDiv.classList.contains('active')) {
                updateDisplay();
            }
        }
        
        // ================ MODE SWITCHING ================
        function switchToBasic() {
            basicModeDiv.classList.remove('hidden');
            scientificModeDiv.classList.remove('active');
            basicModeBtn.classList.add('active');
            scientificModeBtn.classList.remove('active');
            angleToggle.classList.remove('visible');
            angleIndicator.classList.remove('visible');
            updateDisplay();
        }
        
        function switchToScientific() {
            basicModeDiv.classList.add('hidden');
            scientificModeDiv.classList.add('active');
            scientificModeBtn.classList.add('active');
            basicModeBtn.classList.remove('active');
            angleToggle.classList.add('visible');
            angleIndicator.classList.add('visible');
            updateDisplay();
        }
        
        // ================ EVENT HANDLING ================
        function handleButtonClick(e) {
            const btn = e.currentTarget;
            
            if (btn.hasAttribute('data-digit')) {
                appendToExpression(btn.getAttribute('data-digit'));
            }
            else if (btn.hasAttribute('data-op')) {
                setOperator(btn.getAttribute('data-op'));
            }
            else if (btn.hasAttribute('data-action')) {
                const action = btn.getAttribute('data-action');
                switch(action) {
                    case 'clear': clearAll(); break;
                    case 'backspace': backspace(); break;
                    case 'clearEntry': clearEntry(); break;
                    case 'equals': calculateResult(); break;
                    case 'percent': percent(); break;
                    case 'paren_open': insertParen('('); break;
                    case 'paren_close': insertParen(')'); break;
                    case 'mc': memoryClear(); break;
                    case 'mr': memoryRecall(); break;
                    case 'mplus': memoryAdd(); break;
                    case 'mminus': memorySubtract(); break;
                    case 'ms': memoryStore(); break;
                }
            }
            else if (btn.hasAttribute('data-sci')) {
                insertScientific(btn.getAttribute('data-sci'));
            }
        }
        
        function handleAngleClick(e) {
            const mode = e.currentTarget.dataset.angle;
            if (mode) setAngleMode(mode);
        }
        
        // ================ KEYBOARD SUPPORT ================
        function handleKeyboard(e) {
            // Only handle keyboard if calculator is visible
            const calculator = document.querySelector('.calc-wrapper');
            if (!calculator || calculator.offsetParent === null) return;
            
            const key = e.key;
            
            if (/^[0-9.+\-*/=()%]$/.test(key) || key === 'Enter' || key === 'Backspace' || key === 'Escape' || key === 'Delete') {
                e.preventDefault();
            }
            
            if (key >= '0' && key <= '9') {
                appendToExpression(key);
            }
            else if (key === '.') {
                appendToExpression('.');
            }
            else if (key === '+') {
                setOperator('+');
            }
            else if (key === '-') {
                if (currentExpression === "0" || currentExpression === "" || waitingForOperand) {
                    appendToExpression('-');
                } else {
                    setOperator('-');
                }
            }
            else if (key === '*') {
                setOperator('×');
            }
            else if (key === '/') {
                setOperator('÷');
            }
            else if (key === '^') {
                appendToExpression('^');
            }
            else if (key === '(') {
                insertParen('(');
            }
            else if (key === ')') {
                insertParen(')');
            }
            else if (key === '%') {
                percent();
            }
            else if (key === 'Enter' || key === '=') {
                calculateResult();
            }
            else if (key === 'Backspace') {
                backspace();
            }
            else if (key === 'Escape' || key === 'Delete') {
                clearAll();
            }
        }
        
        // ================ INITIALIZATION ================
        function attachEventListeners() {
            document.querySelectorAll('.calc-wrapper .btn').forEach(function(btn) {
                btn.removeEventListener('click', handleButtonClick);
                btn.addEventListener('click', handleButtonClick);
            });
            
            document.querySelectorAll('.calc-wrapper .angle-btn').forEach(function(btn) {
                btn.removeEventListener('click', handleAngleClick);
                btn.addEventListener('click', handleAngleClick);
            });
        }
        
        // Mode switch handlers
        basicModeBtn.addEventListener('click', switchToBasic);
        scientificModeBtn.addEventListener('click', switchToScientific);
        
        // Keyboard support
        document.addEventListener('keydown', handleKeyboard);
        
        // Initial setup
        attachEventListeners();
        
        // Watch for DOM changes
        const observer = new MutationObserver(function() {
            attachEventListeners();
        });
        observer.observe(scientificModeDiv, { childList: true, subtree: true });
        
        // Initialize display
        clearAll();
        setAngleMode('deg');
    })();
