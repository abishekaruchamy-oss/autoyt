import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { NO_STORE_HEADERS, sanitizeErrorMessage } from '@/lib/security';
import { Repository } from '@/server/db/repository';

export async function GET(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const declaration = await Repository.getRightsDeclaration();
    return NextResponse.json(
      {
        success: true,
        isActive: Boolean(declaration && declaration.status === 'ACTIVE'),
        declaration,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: sanitizeErrorMessage(error, 'Failed to read standing rights declaration.'),
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApi(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      operatorIdentity?: string;
      policyVersion?: string;
      declarationText?: string;
      status?: 'ACTIVE' | 'REVOKED';
    };

    const status = body.status === 'REVOKED' ? 'REVOKED' : 'ACTIVE';
    const operatorIdentity = body.operatorIdentity?.trim() || 'operator-admin';

    const declaration = await Repository.saveRightsDeclaration({
      operatorIdentity,
      policyVersion: body.policyVersion || '1.0.0',
      declarationText: body.declarationText,
      status,
    });

    return NextResponse.json(
      {
        success: true,
        isActive: declaration.status === 'ACTIVE',
        declaration,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: sanitizeErrorMessage(error, 'Failed to update standing rights declaration.'),
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
