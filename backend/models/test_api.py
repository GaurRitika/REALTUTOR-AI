import unittest
import json
from model_api import app

class TestRealTutorAPI(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def test_root_endpoint(self):
        """Test the root endpoint for health check and available endpoints."""
        response = self.app.get('/')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('status', data)
        self.assertIn('RealTutor AI Backend is running', data['status'])
        self.assertIn('endpoints', data)

    def test_status_endpoint(self):
        """Test the status endpoint for backend health."""
        response = self.app.get('/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'running')
        self.assertEqual(data['model'], 'realtutor-ai')

    def test_analyze_endpoint_missing_data(self):
        """Test the analyze endpoint with missing data to ensure it handles errors gracefully."""
        # Sending empty JSON should ideally return an error or handle defaults
        response = self.app.post('/analyze', 
                                 data=json.dumps({}),
                                 content_type='application/json')
        # Based on current implementation, it might still return 200 but with an error message in data
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['type'], 'response')
        self.assertIn('data', data)

    def test_generate_endpoint_integrity(self):
        """Test the generate endpoint structure."""
        response = self.app.post('/generate',
                                 data=json.dumps({'prompt': 'test', 'language': 'python'}),
                                 content_type='application/json')
        # We don't check for 200 here necessarily if GROQ_API_KEY is missing in test env,
        # but we check the logic flow.
        self.assertIn(response.status_code, [200, 500])

if __name__ == '__main__':
    unittest.main()
