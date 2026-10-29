/** Account/API error with a code the screens know how to explain (ERROR_TEXT). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export const ERROR_TEXT: Record<string, string> = {
  invalid_email: 'E-mail inválido.',
  weak_password: 'A senha precisa ter pelo menos 8 caracteres.',
  email_taken: 'Já existe uma conta com este e-mail.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  rate_limited: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  too_many_saved: 'Você chegou ao limite de 500 notícias salvas. Remova algumas para salvar novas.',
};
