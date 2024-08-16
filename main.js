require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const { OpenAI } = require('openai');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    databaseURL: process.env.DATABSEURL,
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase:', error);
  process.exit(1);
}

const db = admin.database();

const MEMGPT_SERVER = 'http://13.50.242.126:8083';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 
const AGENT_ID_FILE = 'perpetual_agent_id.txt';

const openai = new OpenAI({
  apiKey: process.env.OPEN_KEY
})
async function summarizeStory(story) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant that summarizes stories concisely." },
        { role: "user", content: `Please summarize the following story:\n\n${story}` }
      ]
    });
    console.log( completion.choices[0].message.content);
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error summarizing story:', error);
    throw new Error('Failed to summarize story');
  }
}

async function storeStoryInDatabase(summary) {
  try {
    const newSummaryRef = db.ref('story_summaries').push();
    await newSummaryRef.set({
      summary: summary,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });
    console.log('Summary stored with ID:', newSummaryRef.key);
    return newSummaryRef.key;
  } catch (error) {
    console.error('Error storing summary in database:', error);
    throw new Error('Failed to store summary in database');
  }
}

async function getLatestSummary() {
  try {
    const snapshot = await db.ref('story_summaries')
      .orderByChild('timestamp')
      .limitToLast(1)
      .once('value');

    if (snapshot.exists()) {
      const summaries = snapshot.val();
      const key = Object.keys(summaries)[0];
      return summaries[key].summary;
    } else {
      console.log('No summaries found.');
      return null;
    }
  } catch (error) {
    console.error('Error fetching latest summary:', error);
    throw new Error('Failed to fetch latest summary');
  }
}

async function createAgentWithMemory(summary) {
  try {
    console.log('Creating new agent with story memory...');
    const response = await axios.post(`${MEMGPT_SERVER}/api/agents`, {
      config: {
        name: "StorytellerAgent",
        preset: "memgpt_chat",
        human: "user",
        persona: "assistant",
        llm_config: {
          model: "gpt-4o",
          max_tokens: 1000,
          temperature: 0.7
        }
      },
      messages: [
        {
          role: "system",
          content: `You are a storyteller AI with knowledge of the following story summary: ${summary}`
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${ADMIN_PASSWORD}`,
        'Content-Type': 'application/json'
      }
    });
    const newAgentId = response.data.agent_state.id;
    await fs.writeFile(AGENT_ID_FILE, newAgentId);
    console.log('New agent created with ID:', newAgentId);
    return newAgentId;
  } catch (error) {
    console.error('Error creating agent:', error.response ? error.response.data : error.message);
    throw new Error('Failed to create agent');
  }
}

async function updateAgentMemory(agentId, summary) {
  try {
    console.log(`Updating agent ${agentId} with new summary...`);
    await axios.post(`${MEMGPT_SERVER}/api/agents/${agentId}/messages`, {
      agent_id: agentId,
      message: `Add this new story summary to your knowledge base, while retaining all previous story information: ${summary}`,
      role: "system"
    }, {
      headers: {
        'Authorization': `Bearer ${ADMIN_PASSWORD}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Agent memory updated successfully with new story');
  } catch (error) {
    console.error('Error updating agent memory:', error.response ? error.response.data : error.message);
    throw new Error('Failed to update agent memory');
  }
}

async function getOrCreateAgent() {
  try {
    const agentId = await fs.readFile(AGENT_ID_FILE, 'utf8');
    console.log('Using existing agent ID:', agentId.trim());
    return agentId.trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      const summary = await getLatestSummary();
      if (summary) {
        return await createAgentWithMemory(summary);
      } else {
        console.log('No summary available. Please create a summary first.');
        return null;
      }
    } else {
      console.error('Error reading agent ID file:', error);
      throw new Error('Failed to get or create agent');
    }
  }
}

async function sendMessage(agentId, message) {
  try {
    console.log(`Sending message to agent ${agentId}: "${message}"`);
    const response = await axios.post(`${MEMGPT_SERVER}/api/agents/${agentId}/messages`, {
      agent_id: agentId,
      message: message,
      stream: false,
      role: "user"
    }, {
      headers: {
        'Authorization': `Bearer ${ADMIN_PASSWORD}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.messages) {
      const assistantMessage = response.data.messages.find(msg => msg.function_call && msg.function_call.name === 'send_message');
      if (assistantMessage && assistantMessage.function_call.arguments) {
        const args = JSON.parse(assistantMessage.function_call.arguments);
        return args.message;
      } else {
        throw new Error('Assistant message not found in the response');
      }
    } else {
      throw new Error('Unexpected response format');
    }
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
    throw new Error('Failed to send message');
  }
}

async function addNewStory(story) {
  try {
    const summary = await summarizeStory(story);
    console.log("Generated summary:", summary);
    const summaryId = await storeStoryInDatabase(summary);
    await updateAgentWithNewStory(summary);
    return summaryId;
  } catch (error) {
    console.error('Error adding new story:', error);
    throw new Error('Failed to add new story');
  }
}

async function updateAgentWithNewStory(newSummary) {
  try {
    const agentId = await getOrCreateAgent();
    if (agentId) {
      await updateAgentMemory(agentId, newSummary);
    } else {
      console.log('No agent found. Creating a new one...');
      await createAgentWithMemory(newSummary);
    }
  } catch (error) {
    console.error('Error updating agent with new story:', error);
    throw new Error('Failed to update agent with new story');
  }
}

// API routes
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const agentId = await getOrCreateAgent();
    if (agentId) {
      const response = await sendMessage(agentId, message);
      console.log(response);
      res.json({ response });
    } else {
      res.status(500).json({ error: 'Failed to create or retrieve an agent' });
    }
  } catch (error) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});
app.get("/", (req, res) => res.send("Express on Vercel"));

app.post('/api/new-story', async (req, res) => {
  try {
    const { story } = req.body;
    if (!story) {
      return res.status(400).json({ error: 'Story is required' });
    }
    const summaryId = await addNewStory(story);
    res.json({ success: true, summaryId  });
  } catch (error) {
    console.error('Error in /api/new-story:', error);
    res.status(500).json({ error: 'Failed to add new story', details: error.message });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});