import contextlib
import io
import unittest
from unittest.mock import patch
import smspva


class Tests(unittest.TestCase):
    def test_pending_then_code(self):
        class Fake:
            def __init__(self):
                self.calls = []
            def call(self, path):
                self.calls.append(path)
                return None if len(self.calls) == 1 else {'sms': {'code': '001234', 'fullText': 'Tu código: 001234'}}
        api = Fake()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            smspva.wait_sms(api, {'orderId': 12, 'countryCode': '+52', 'phoneNumber': '8112345678', 'orderExpireIn': 600})
        self.assertEqual(api.calls, ['sms/12', 'sms/12'])
        self.assertIn('001234', out.getvalue())
        self.assertIn('+528112345678', out.getvalue())

    def test_expiry_reports_number(self):
        from unittest.mock import Mock
        api = Mock()
        with contextlib.redirect_stdout(io.StringIO()):
            smspva.wait_sms(api, {'orderId': 12, 'countryCode': '+52', 'phoneNumber': '8112345678', 'orderExpireIn': 0})
        api.call.assert_called_once_with('blocknumber/12', 'PUT')

    def test_back_does_not_buy(self):
        from unittest.mock import Mock
        api = Mock()
        with patch('builtins.input', side_effect=['WhatsApp', 'q', 'q']), contextlib.redirect_stdout(io.StringIO()):
            smspva.buy(api, {'opt20': 'WhatsApp'})
        api.call.assert_not_called()

    def test_back_one_level_preserves_selection(self):
        from unittest.mock import Mock
        api = Mock()
        api.call.return_value = {'clist': [{'cname': 'Mexico', 'ccode': 'MX', 'opers': [
            {'opcode': 'Test_MX', 'count': 2, 'price': 1}]}]}
        out = io.StringIO()
        # Confirmar -> operador -> país -> servicios -> buscar -> inicio.
        answers = ['Facebook', '1', '1', '1', 'Q', 'q', 'q', 'q', 'q']
        with patch('builtins.input', side_effect=answers), contextlib.redirect_stdout(out):
            smspva.buy(api, {'opt2': 'Facebook'})
        api.call.assert_called_once_with('serviceprices/opt2')
        self.assertIn('Inicio > Pedir número > Facebook > Mexico > Test_MX > Confirmar', out.getvalue())
        self.assertEqual(out.getvalue().count('Facebook > Mexico > Operador'), 2)


if __name__ == '__main__':
    unittest.main()
