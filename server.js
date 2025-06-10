// server.js - TaskBoard Backend API (Simplified - Solo Tareas)
const express = require('express');
const cors = require('cors');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand, 
  UpdateCommand, 
  DeleteCommand, 
  ScanCommand
} = require('@aws-sdk/lib-dynamodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// DynamoDB Configuration for Production (using IAM Role)
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  // Las credenciales se obtienen automáticamente del IAM Role asignado al EC2
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Tabla tasks
const TASKS_TABLE = process.env.TASKS_TABLE || 'task_equipo_1';
// Tabla boards
const BOARDS_TABLE = process.env.BOARDS_TABLE || 'board_equipo_1';

// Utility function para generar IDs únicos
const generateId = () => {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
};

// ================================
// TASKS ENDPOINTS
// ================================

// GET /tasks - Obtener todas las tareas
app.get('/tasks', async (req, res) => {
  try {
    const { boardId } = req.query; // Obtener boardId del query parameter

    let command;
    
    if (boardId) {
      // Si se especifica boardId, filtrar tareas de ese board
      command = new ScanCommand({
        TableName: TASKS_TABLE,
        FilterExpression: 'boardId = :boardId',
        ExpressionAttributeValues: {
          ':boardId': boardId
        }
      });
    } else {
      // Si no se especifica boardId, obtener todas las tareas
      command = new ScanCommand({
        TableName: TASKS_TABLE
      });
    }
    
    const result = await docClient.send(command);
    const tasks = result.Items || [];
    
    // Organizar tareas por status para el frontend
    const organizedTasks = {
      todo: tasks.filter(task => task.status === 'todo'),
      'in-progress': tasks.filter(task => task.status === 'in-progress'),
      done: tasks.filter(task => task.status === 'done')
    };

    res.json({
      success: true,
      tasks: tasks,
      tasksByStatus: organizedTasks,
      total: tasks.length,
      boardId: boardId || null
    });
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching tasks'
    });
  }
});

// GET /tasks/:id - Obtener una tarea específica
app.get('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const command = new GetCommand({
      TableName: TASKS_TABLE,
      Key: { id }
    });

    const result = await docClient.send(command);

    if (!result.Item) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    res.json({
      success: true,
      task: result.Item
    });
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching task'
    });
  }
});

// POST /tasks - Crear una nueva tarea
app.post('/tasks', async (req, res) => {
  try {
    const { title, description, status, boardId } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    if (!boardId) {
      return res.status(400).json({
        success: false,
        error: 'Board ID is required'
      });
    }

    // Validar que el board existe
    const boardCommand = new GetCommand({
      TableName: BOARDS_TABLE,
      Key: { id: boardId }
    });

    const boardResult = await docClient.send(boardCommand);
    
    if (!boardResult.Item) {
      return res.status(404).json({
        success: false,
        error: 'Board not found'
      });
    }

    // Validar que el status sea válido
    const validStatuses = ['todo', 'in-progress', 'done'];
    const taskStatus = status || 'todo';
    
    if (!validStatuses.includes(taskStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: todo, in-progress, or done'
      });
    }

    const task = {
      id: generateId(),
      boardId,  // ← Añadir boardId
      title,
      description: description || '',
      status: taskStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const command = new PutCommand({
      TableName: TASKS_TABLE,
      Item: task
    });

    await docClient.send(command);

    res.status(201).json({
      success: true,
      task
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({
      success: false,
      error: 'Error creating task'
    });
  }
});

// PUT /tasks/:id - Actualizar una tarea (perfecto para drag & drop)
app.put('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status } = req.body;

    // Validar que la tarea existe
    const getCommand = new GetCommand({
      TableName: TASKS_TABLE,
      Key: { id }
    });

    const existingTask = await docClient.send(getCommand);
    
    if (!existingTask.Item) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Preparar los campos a actualizar
    let updateExpression = 'SET updatedAt = :updatedAt';
    let expressionAttributeValues = {
      ':updatedAt': new Date().toISOString()
    };

    if (title) {
      updateExpression += ', title = :title';
      expressionAttributeValues[':title'] = title;
    }

    if (description !== undefined) {
      updateExpression += ', description = :description';
      expressionAttributeValues[':description'] = description;
    }

    if (status) {
      const validStatuses = ['todo', 'in-progress', 'done'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be: todo, in-progress, or done'
        });
      }
      updateExpression += ', #status = :status';
      expressionAttributeValues[':status'] = status;
    }

    const updateCommand = new UpdateCommand({
      TableName: TASKS_TABLE,
      Key: { id },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
      ReturnValues: 'ALL_NEW'
    });

    const result = await docClient.send(updateCommand);

    res.json({
      success: true,
      task: result.Attributes
    });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({
      success: false,
      error: 'Error updating task'
    });
  }
});

// DELETE /tasks/:id - Eliminar una tarea
app.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la tarea existe
    const getCommand = new GetCommand({
      TableName: TASKS_TABLE,
      Key: { id }
    });

    const existingTask = await docClient.send(getCommand);
    
    if (!existingTask.Item) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const deleteCommand = new DeleteCommand({
      TableName: TASKS_TABLE,
      Key: { id }
    });

    await docClient.send(deleteCommand);

    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({
      success: false,
      error: 'Error deleting task'
    });
  }
});

// ================================
// DASHBOARD ENDPOINT (Estadísticas)
// ================================

// GET /dashboard - Estadísticas del tablero
app.get('/dashboard', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: TASKS_TABLE
    });
    
    const result = await docClient.send(command);
    const tasks = result.Items || [];

    const stats = {
      total: tasks.length,
      todo: tasks.filter(task => task.status === 'todo').length,
      inProgress: tasks.filter(task => task.status === 'in-progress').length,
      done: tasks.filter(task => task.status === 'done').length,
      completionRate: tasks.length > 0 ? Math.round((tasks.filter(task => task.status === 'done').length / tasks.length) * 100) : 0
    };

    res.json({
      success: true,
      stats,
      recentTasks: tasks
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 5)
    });
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching dashboard stats'
    });
  }
});

// ================================
// BOARD ENDPOINTS
// ================================

app.get('/boards', async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: BOARDS_TABLE
    });
    
    const result = await docClient.send(command);
    const boards = result.Items || [];

    res.json({
      success: true,
      boards: boards,
      total: boards.length
    });
  } catch (error) {
    console.error('Error getting boards:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching boards'
    });
  }
});

// ================================
// HEALTH CHECK
// ================================

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'TaskBoard API is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ================================
// ERROR HANDLING
// ================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ================================
// START SERVER
// ================================

app.listen(PORT, () => {
  console.log(`🚀 TaskBoard API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`📝 Tasks: http://localhost:${PORT}/tasks`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
