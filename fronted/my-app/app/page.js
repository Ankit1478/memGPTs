"use client"


import React, { useState } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [newStory, setNewStory] = useState('');
  const [isAddingStory, setIsAddingStory] = useState(false);

  const sendMessage = async () => {
    if (inputMessage.trim() === '') return;

    setMessages(prev => [...prev, { role: 'user', content: inputMessage }]);
    setInputMessage('');

    try {
      const response = await axios.post(`${API_URL}/chat`, { message: inputMessage });
      setMessages(prev => [...prev, { role: 'assistant', content: response.data.response }]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Unable to get response.' }]);
    }
  };

  const addNewStory = async () => {
    if (newStory.trim() === '') return;

    try {
      const response = await axios.post(`${API_URL}/new-story`, { story: newStory });
      if (response.data.success) {
        setMessages(prev => [...prev, { role: 'system', content: 'New story added successfully!' }]);
        setNewStory('');
        setIsAddingStory(false);
      }
    } catch (error) {
      console.error('Error adding new story:', error);
      setMessages(prev => [...prev, { role: 'system', content: 'Error: Unable to add new story.' }]);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl bg-white rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold text-center text-blue-600 mb-6">Story AI Chat</h1>
      
      <div className="bg-gray-100 p-4 rounded-lg mb-6 h-96 overflow-y-auto shadow-inner">
        {messages.map((msg, index) => (
          <div key={index} className={`mb-3 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
            <span className={`inline-block px-4 py-2 rounded-lg ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'} shadow-sm`}>
              {msg.content}
            </span>
          </div>
        ))}
      </div>

      {isAddingStory ? (
        <div className="mb-6">
          <textarea
            className="w-full p-4 border rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows="4"
            value={newStory}
            onChange={(e) => setNewStory(e.target.value)}
            placeholder="Enter your new story here..."
          />
          <div className="flex mt-4">
            <button
              className="bg-green-500 text-white px-6 py-2 rounded-lg shadow-md hover:bg-green-600 transition-colors"
              onClick={addNewStory}
            >
              Add Story
            </button>
            <button
              className="bg-gray-500 text-white px-6 py-2 rounded-lg shadow-md hover:bg-gray-600 transition-colors ml-4"
              onClick={() => setIsAddingStory(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="bg-blue-500 text-white px-6 py-2 rounded-lg shadow-md mb-6 hover:bg-blue-600 transition-colors"
          onClick={() => setIsAddingStory(true)}
        >
          Add New Story
        </button>
      )}

      <div className="flex">
        <input
          type="text"
          className="flex-grow p-4 border rounded-l-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Type your message..."
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button
          className="bg-blue-500 text-white px-6 py-2 rounded-r-lg shadow-md hover:bg-blue-600 transition-colors"
          onClick={sendMessage}
        >
          Send
        </button>
      </div>
    </div>
  );
}
