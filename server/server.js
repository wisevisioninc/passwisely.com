const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const compression = require("compression");
const sharp = require("sharp");

// Cache structure
const responseCache = new Map();
const CACHE_TTL = 1800000; // 30 minutes

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.openai.com/v1",
});

// Middleware setup
app.use(compression());
app.use(cors());
app.use(
    express.json({
        limit: "50mb",
        strict: false,
        inflate: true,
        type: "application/json",
    }),
);

// Request timeout handling
app.use((req, res, next) => {
    req.setTimeout(60000);
    res.setTimeout(60000);
    next();
});

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Cache middleware
function cacheMiddleware(req, res, next) {
    const key = req.url + JSON.stringify(req.body);
    const cachedResponse = responseCache.get(key);

    if (cachedResponse && Date.now() - cachedResponse.timestamp < CACHE_TTL) {
        return res.json(cachedResponse.data);
    }

    res.originalJson = res.json;
    res.json = (data) => {
        responseCache.set(key, {
            timestamp: Date.now(),
            data,
        });
        res.originalJson(data);
    };
    next();
}

function processInputText(inputText) {
    console.log("Processing input text:", inputText);
    // Implement your logic to handle the input text
    // For example, you could log it, store it, or perform some operation
    return {message: "Input text processed successfully"};
}

// Image compression function
async function compressImage(base64String) {
    try {
        // Extract the actual base64 data
        const base64Data = base64String.split(";base64,").pop();
        const buffer = Buffer.from(base64Data, "base64");

        // Compress image using sharp
        const compressedBuffer = await sharp(buffer)
            .resize(1200, 1200, {
                fit: "inside",
                withoutEnlargement: true,
            })
            .jpeg({
                quality: 25,
                progressive: true,
            })
            .toBuffer();

        // Convert back to base64
        const compressedBase64 = `data:image/jpeg;base64,${compressedBuffer.toString("base64")}`;

        // Log compression stats
        const originalSize = Math.round(base64String.length / 1024);
        const compressedSize = Math.round(compressedBase64.length / 1024);
        console.log(
            `Image compressed: ${originalSize}KB -> ${compressedSize}KB (${Math.round((compressedSize / originalSize) * 100)}%)`,
        );

        return compressedBase64;
    } catch (error) {
        console.error("Image compression error:", error);
        return base64String; // Return original if compression fails
    }
}

async function extractProblemFromImg(imageBase64) {
    const completion = await openai.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [
            {
                role: 'system',
                content: 'You are an assistant that extracts coding problems from images. Extract the complete problem statement, including any requirements and examples.'
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Extract the coding problem from this image:'
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${imageBase64.split(',')[1]}`
                        }
                    }
                ]
            }
        ],
        max_tokens: 1600,
        temperature: 0,
    });

    return completion.choices[0].message.content;
}

async function generateCode(problemText, query = '') {
    if (!problemText && !query) {
        throw {error: "No problem text provided"};
    }

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content:
                    "You are a skilled programming assistant. Provide solutions in valid JSON format.",
            },
            {
                role: "user",
                content: `Solve the following system design problem in detailed steps:\n${problemText}, ${query}\n
          Provide your solution in the following JSON format:
          {
            "code": "text in markdown formatting that contains the solution in detail containing all the steps in the system design problem",
            "thoughts": [
            "potential follow up question and answer (seperated by ---) #1",
            "potential follow up question and answer (seperated by ---) #2",
            "potential follow up question and answer (seperated by ---) #3",
            "potential follow up question and answer (seperated by ---) #4",
            "potential follow up question and answer (seperated by ---) #5",
            "potential follow up question and answer (seperated by ---) #6",
            "potential follow up question and answer (seperated by ---) #7",
            "potential follow up question and answer (seperated by ---) #8",
            "potential follow up question and answer (seperated by ---) #9",
            "potential follow up question and answer (seperated by ---) #10",
            ]
          }`,
            },
        ],
        temperature: 0.3,
        max_tokens: 1600,
        response_format: {type: "json_object"},
    });

    return completion.choices[0].message.content;
}

async function debugCode(problemText, language) {
    if (!problemText) {
        throw {error: "No problem text provided"};
    }

    console.log("Sending problem to GPT-4o for debugging...");
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Using GPT-4o
        messages: [
            {
                role: "system",
                content:
                    "You are a skilled programming assistant. Provide debug solutions in valid JSON format.",
            },
            {
                role: "user",
                content: `Debug the following problem in ${language}:\n${problemText}\n
          Provide your debug solution in the following JSON format:
          {
            "code": "your complete fixed code solution here",
            "thoughts": ["debug observation 1", "debug observation 2", "debug observation 3"],
            "time_complexity": "O(n) explanation here",
            "space_complexity": "O(n) explanation here"
          }`,
            },
        ],
        temperature: 0.3,
        max_tokens: 1600,
        response_format: {type: "json_object"},
    });

    return completion.choices[0].message.content;
}

// Text extraction endpoint (specifically for /api/extract)
app.post("/api/extract", cacheMiddleware, async (req, res) => {
    const {imageDataList, language = "eng", query} = req.body;

    try {
        if (
            !imageDataList ||
            !Array.isArray(imageDataList) ||
            imageDataList.length === 0
        ) {
            console.log("empty list!");
            return res.status(400).json({error: "Invalid imageDataList"});
        }

        // Compress all images in parallel
        const compressedImages = await Promise.all(
            imageDataList.map((imageData) => compressImage(imageData)),
        );

        const messages = [
            {
                role: "system",
                content: `You are a precise OCR system. Extract all text from the images, maintaining proper formatting.
                 Language preference: ${language}. Return only the extracted text without any additional commentary.`,
            },
        ];

        // Process each compressed image
        for (const imageData of compressedImages) {
            messages.push({
                role: "user",
                content: [
                    {type: "text", text: "Extract text from this image:"},
                    {
                        type: "image_url",
                        image_url: {
                            url: imageData,
                            detail: "high",
                        },
                    },
                ],
            });
        }

        console.log("Sending images to GPT-4o for text extraction...");
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Using GPT-4o instead of vision-preview
            messages,
            max_tokens: 1600,
            temperature: 0,
        });

        const problemText = completion.choices[0].message.content;
        console.log(
            "GPT-4o extraction successful. Extracted text:",
            problemText.substring(0, 100) + (problemText.length > 100 ? "..." : ""),
        );

        res.json({problemText});
    } catch (error) {
        console.error("GPT-4o extraction error:", error);
        res
            .status(500)
            .json({error: "Text extraction failed", details: error.message});
    }
});

// Text extraction endpoint (specifically for /api/extractProblem)
app.post("/api/extractProblem", cacheMiddleware, async (req, res) => {
    const imageBase64 = req.body.imageBase64;
    if (!imageBase64) {
        return res.status(400).json({error: "Invalid image"});
    }

    try {
        const problemText = extractProblemFromImg(imageBase64);
        console.log(
            "GPT-4o extraction successful. Extracted text:",
            problemText.substring(0, 100) + (problemText.length > 100 ? "..." : ""),
        );

        res.json({problemText});
    } catch (error) {
        console.error("GPT-4o extraction error:", error);
        res
            .status(500)
            .json({error: "Text extraction failed", details: error.message});
    }
});

// Code generation endpoint
app.post("/api/generate", cacheMiddleware, async (req, res) => {
    const {problemText, language = "java", query} = req.body;
    if (!problemText && !query) {
        return res.status(400).json({error: "No problem text provided"});
    }

    try {
        console.log(
            "Sending problem to GPT-4o for solution generation... and query:",
            query,
        );

        const fullResponse = generateCode(problemText, query);

        try {
            const jsonResponse = JSON.parse(fullResponse);

            res.json({
                code: jsonResponse.code || "",
                thoughts: Array.isArray(jsonResponse.thoughts)
                    ? jsonResponse.thoughts
                    : ["No specific thoughts provided"],
                time_complexity: jsonResponse.time_complexity || "Not specified",
                space_complexity: jsonResponse.space_complexity || "Not specified",
            });
        } catch (error) {
            console.error("JSON parsing error:", error);
            res.json({
                code:
                    fullResponse.replace(/```[\w]*\n([\s\S]*?)```/g, "$1").trim() ||
                    fullResponse,
                thoughts: ["Automatically extracted from unstructured response"],
                time_complexity: "Could not determine from response",
                space_complexity: "Could not determine from response",
            });
        }
    } catch (error) {
        console.error("Generation error:", error);
        res
            .status(500)
            .json({error: "Generation failed", details: error.message});
    }
});

// Debug endpoint
app.post("/api/debug", cacheMiddleware, async (req, res) => {
    const {problemText, language = "java"} = req.body;
    if (!problemText) {
        return res.status(400).json({error: "No problem text provided"});
    }

    try {
        const fullResponse = debugCode(problemText, language);

        try {
            const jsonResponse = JSON.parse(fullResponse);

            res.json({
                code: jsonResponse.code || "",
                thoughts: Array.isArray(jsonResponse.thoughts)
                    ? jsonResponse.thoughts
                    : ["No specific debug observations provided"],
                time_complexity: jsonResponse.time_complexity || "Not specified",
                space_complexity: jsonResponse.space_complexity || "Not specified",
            });
        } catch (error) {
            console.error("JSON parsing error:", error);
            res.json({
                code:
                    fullResponse.replace(/```[\w]*\n([\s\S]*?)```/g, "$1").trim() ||
                    fullResponse,
                thoughts: ["Automatically extracted from unstructured debug response"],
                time_complexity: "Could not determine from response",
                space_complexity: "Could not determine from response",
            });
        }
    } catch (error) {
        console.error("Debug error:", error);
        res
            .status(500)
            .json({error: "Debug generation failed", details: error.message});
    }
});

// Test endpoint for OpenAI
app.get("/api/test-openai", async (req, res) => {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {role: "user", content: "Say 'OpenAI GPT-4o API is working'"},
            ],
            temperature: 0,
            max_tokens: 10,
        });

        res.json({
            status: "success",
            message: completion.choices[0].message.content,
        });
    } catch (error) {
        res.status(500).json({status: "error", error: error.message});
    }
});

app.post("/api/process-input", async (req, res) => {
    const {inputText} = req.body;
    if (!inputText) {
        return res.status(400).json({error: "No input text provided"});
    }

    console.log("Received input text:", inputText);

    try {
        // Use the input text as the problem text for GPT-4o
        console.log("Sending input text to GPT-4o for solution generation...");
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content:
                        "You are a skilled programming assistant. Provide solutions in valid JSON format.",
                },
                {
                    role: "user",
                    content: `Solve the following system design problem in steps:\n${inputText}\n
          Provide your solution in the following JSON format:
          {
            "code": "text in markdown formatting that contains the solution in details containing all the steps in a system design problem",
            "thoughts": ["thought 1", "thought 2", "thought 3"]
          }`,
                },
            ],
            temperature: 0.3,
            max_tokens: 1600,
            response_format: {type: "json_object"},
        });

        const fullResponse = completion.choices[0].message.content;

        try {
            const jsonResponse = JSON.parse(fullResponse);

            res.json({
                code: jsonResponse.code || "",
                thoughts: Array.isArray(jsonResponse.thoughts)
                    ? jsonResponse.thoughts
                    : ["No specific thoughts provided"],
                time_complexity: "Could not determine from response",
                space_complexity: "Could not determine from response",
            });
        } catch (error) {
            console.error("JSON parsing error:", error);
            res.json({
                code:
                    fullResponse.replace(/```[\w]*\n([\s\S]*?)```/g, "$1").trim() ||
                    fullResponse,
                thoughts: ["Automatically extracted from unstructured response"],
            });
        }
    } catch (error) {
        console.error("Generation error:", error);
        res
            .status(500)
            .json({error: "Generation failed", details: error.message});
    }
});

app.post("/api/solve", async (req, res) => {
    const {imageBase64, language = "java"} = req.body;

    if (!imageBase64) {
        return res.status(400).json({error: "Invalid image"});
    }

    try {
        const problemText = extractProblemFromImg(imageBase64);

        const fullResponse = debugCode(problemText);

        try {
            const jsonResponse = JSON.parse(fullResponse);

            res.json({
                code: jsonResponse.code || "",
                thoughts: Array.isArray(jsonResponse.thoughts)
                    ? jsonResponse.thoughts
                    : ["No specific debug observations provided"],
                time_complexity: jsonResponse.time_complexity || "Not specified",
                space_complexity: jsonResponse.space_complexity || "Not specified",
            });
        } catch (error) {
            console.error("JSON parsing error:", error);
            res.json({
                code:
                    fullResponse.replace(/```[\w]*\n([\s\S]*?)```/g, "$1").trim() ||
                    fullResponse,
                thoughts: ["Automatically extracted from unstructured debug response"],
                time_complexity: "Could not determine from response",
                space_complexity: "Could not determine from response",
            });
        }
    } catch (error) {
        console.error("Generation error:", error);
        res
            .status(500)
            .json({error: "Generation failed", details: error.message});
    }
});

app.get("/cron", (req, res) => {
    console.log(`${new Date().toISOString()} - Cron endpoint called`);
    res.send("happy");
});

// Error handling
process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection:", reason);
});

// Cleanup on shutdown
process.on("SIGTERM", async () => {
    responseCache.clear();
    process.exit(0);
});

// Start server
app.listen(port, () => {
    console.log(
        `Server listening on port ${port} at ${new Date().toISOString()}`,
    );
    console.log(`API endpoints available:
  - POST /api/extract - Extract text from images using GPT-4o
  - POST /api/generate - Generate solutions from problem text using GPT-4o
  - POST /api/debug - Debug code problems using GPT-4o
  - GET /api/test-openai - Test OpenAI API connectivity`);
});
